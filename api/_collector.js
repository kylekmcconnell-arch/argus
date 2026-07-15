// server/config.ts
var PROVIDERS = [
  { id: "claude-research", label: "Claude (cited basic-facts research)", env: ["ANTHROPIC_API_KEY"], free: false, feeds: "founders, product, token, launch, governance, audits, repositories, funding and traction leads with sources" },
  { id: "grok", label: "Grok (X + cited web discovery)", env: ["XAI_API_KEY"], free: false, feeds: "testimonial acknowledgment, recent activity, sentiment, portfolio and fund-scale leads" },
  { id: "twitterapi", label: "twitterapi.io (X follow graph)", env: ["TWITTERAPI_KEY"], free: false, feeds: "follower/following graph, profile, account age" },
  { id: "coingecko", label: "CoinGecko", env: ["COINGECKO_API_KEY"], free: true, feeds: "token price/mcap, call performance (K2)" },
  { id: "cryptorank", label: "CryptoRank", env: ["CRYPTORANK_API_KEY"], free: false, feeds: "market intel: rank, ATH drawdown, dilution, unlock/vesting flags" },
  { id: "dexscreener", label: "DexScreener", env: [], free: true, feeds: "live DEX liquidity/volume, rug signals" },
  { id: "crunchbase", label: "Crunchbase", env: ["CRUNCHBASE_API_KEY"], free: false, feeds: "optional company/funding enrichment; never required for portfolio certification" },
  { id: "peopledatalabs", label: "People Data Labs", env: ["PDL_API_KEY"], free: false, feeds: "identity, off-LinkedIn career history (F1/F2)" },
  { id: "github", label: "GitHub forensics", env: ["GITHUB_TOKEN"], free: false, feeds: "twitter-linked identity, org/repo affiliations (F1/F2)" },
  { id: "reddit", label: "Reddit", env: ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET"], free: false, feeds: "community FUD / reputation (F5/I5/AG4)" },
  { id: "helius", label: "Helius (Solana)", env: ["HELIUS_API_KEY"], free: false, feeds: "attributed-wallet activity (K4 context)" },
  { id: "bitquery", label: "Bitquery (not yet in core collector)", env: ["BITQUERY_API_KEY"], free: false, feeds: "reserved credential only; does not run or attest core audits" },
  { id: "analyst", label: "Claude analyst agent", env: ["ANTHROPIC_API_KEY"], free: false, feeds: "messy-to-structured axis scoring + rationale + headline" }
];
function hasEnv(keys) {
  if (keys.length === 0) return true;
  return keys.every((k) => !!process.env[k]);
}
function env(key) {
  return process.env[key];
}
function providerStatus() {
  return PROVIDERS.map((p) => ({
    id: p.id,
    label: p.label,
    free: p.free,
    feeds: p.feeds,
    configured: hasEnv(p.env)
  }));
}
var ANALYST_MODEL = process.env.ARGUS_ANALYST_MODEL || "claude-sonnet-4-6";

// src/engine/taxonomy.ts
var SubjectClass = /* @__PURE__ */ ((SubjectClass2) => {
  SubjectClass2["FOUNDER"] = "FOUNDER";
  SubjectClass2["PROJECT"] = "PROJECT";
  SubjectClass2["KOL"] = "KOL";
  SubjectClass2["INVESTOR"] = "INVESTOR";
  SubjectClass2["ADVISOR"] = "ADVISOR";
  SubjectClass2["AGENCY"] = "AGENCY";
  SubjectClass2["MEMBER"] = "MEMBER";
  return SubjectClass2;
})(SubjectClass || {});
var DOX_BONUS = { Confirmed: 5, Probable: 3 };
var VentureOutcome = /* @__PURE__ */ ((VentureOutcome2) => {
  VentureOutcome2["ACTIVE"] = "Active";
  VentureOutcome2["PAUSED"] = "Paused";
  VentureOutcome2["IPO"] = "IPO";
  VentureOutcome2["ACQUISITION"] = "Acquisition";
  VentureOutcome2["ACQUIHIRE"] = "Acquihire";
  VentureOutcome2["ORDERLY_WINDDOWN"] = "OrderlyWindDown";
  VentureOutcome2["FAILURE"] = "Failure";
  VentureOutcome2["SILENT_SHUTDOWN"] = "SilentShutdown";
  VentureOutcome2["RUG"] = "Rug";
  VentureOutcome2["EXPLOIT"] = "Exploit";
  VentureOutcome2["UNKNOWN"] = "Unknown";
  return VentureOutcome2;
})(VentureOutcome || {});
var NON_TERMINAL = /* @__PURE__ */ new Set([
  "Active" /* ACTIVE */,
  "Paused" /* PAUSED */,
  "Unknown" /* UNKNOWN */
]);
var POSITIVE_OUTCOMES = /* @__PURE__ */ new Set([
  "IPO" /* IPO */,
  "Acquisition" /* ACQUISITION */
]);
var SEVERE_OUTCOMES = /* @__PURE__ */ new Set(["Rug" /* RUG */]);
function classifyFounderPattern(outcomes) {
  const outs = outcomes.map((o) => o);
  const completed = outs.filter((o) => !NON_TERMINAL.has(o));
  if (outs.some((o) => SEVERE_OUTCOMES.has(o))) return "RugHistory" /* RUG_HISTORY */;
  if (outs.length === 0) return "FirstVenture" /* FIRST_VENTURE */;
  if (completed.length === 0) return "Unproven" /* UNPROVEN */;
  const successes = completed.filter((o) => POSITIVE_OUTCOMES.has(o)).length;
  const failures = completed.filter(
    (o) => o === "SilentShutdown" /* SILENT_SHUTDOWN */ || o === "Failure" /* FAILURE */
  ).length;
  if (successes >= 2 && failures === 0) return "SerialSuccess" /* SERIAL_SUCCESS */;
  if (successes === 1 && failures === 0) return "ProvenOnce" /* PROVEN_ONCE */;
  if (successes === 0 && failures >= 2) return "SerialFailure" /* SERIAL_FAILURE */;
  if (successes >= 1 && failures >= 1) return "Mixed" /* MIXED */;
  return "Unproven" /* UNPROVEN */;
}
var norm = (name) => String(name).trim().toLowerCase();
function repeatBackingSignal(ventures) {
  const current = /* @__PURE__ */ new Set();
  const repeat = /* @__PURE__ */ new Set();
  let fromSuccess = false;
  for (const v of ventures) {
    if (v.outcome === "Active" /* ACTIVE */) {
      for (const b of v.current_backers ?? []) current.add(norm(b));
    }
  }
  for (const v of ventures) {
    const priorParties = new Set((v.investors ?? []).map(norm));
    if (v.acquirer) priorParties.add(norm(v.acquirer));
    const overlap = [...priorParties].filter((p) => current.has(p));
    if (overlap.length) {
      overlap.forEach((o) => repeat.add(o));
      if (POSITIVE_OUTCOMES.has(v.outcome)) fromSuccess = true;
    }
  }
  let strength;
  if (repeat.size === 0) strength = "none";
  else if (fromSuccess) strength = "strong";
  else strength = "weak";
  return {
    repeat_backers: [...repeat].sort(),
    from_successful_exit: fromSuccess,
    strength
  };
}

// src/engine/profiles.ts
var SHARED_CAPS = {
  deception_confirmed: 10,
  investigator_verified_fraud: 10,
  trust_graph_hard_link: 10,
  trust_graph_medium_link: 69
};
var PROFILES = {
  ["FOUNDER" /* FOUNDER */]: {
    label: "Founder / Core Team",
    lens: "Evaluated as a collaborator or co-conspirator. The question is what this person has built before and how each venture ended.",
    axes: {
      F1_identity_verifiability: 12,
      F2_track_record: 28,
      F3_repeat_backing: 15,
      F4_build_substance: 15,
      F5_reputation_integrity: 18,
      F6_network_quality: 12
    },
    caps: { prior_rug_as_principal: 10, operates_manipulation_tooling: 10 },
    flags: [
      "serial failure pattern: repeated silent shutdowns with no exits",
      "any prior rug or exit scam as a named principal",
      "builds or operates tooling for undetectable token manipulation (bundlers, mixers, volume fakers, multi-wallet snipe bots): the means and motive to rug",
      "claimed exits unverifiable against acquirer or press",
      "no prior backer or acquirer re-backed the new venture despite a claimed exit",
      "GitHub or product substance absent despite a builder persona"
    ],
    sources: [
      "LinkedIn",
      "Crunchbase",
      "Pitchbook",
      "company press / M&A coverage",
      "GitHub",
      "prior cap-table / round announcements",
      "X history"
    ]
  },
  ["PROJECT" /* PROJECT */]: {
    label: "Project / Protocol",
    lens: "Evaluated as an organization, not a person: a token, protocol, product, or company's own brand account. The question is whether a real team ships a real product with honest tokenomics, or whether it is a hype shell built to exit.",
    axes: {
      P1_team_and_identity: 16,
      P2_product_substance: 24,
      P3_token_conduct: 20,
      P4_backing_and_partners: 14,
      P5_traction_and_liveness: 14,
      P6_transparency_integrity: 12
    },
    caps: { team_prior_rug: 10, abandoned_or_dormant: 25 },
    flags: [
      "no named team behind a project raising money or holding a token",
      "the team (or its members) rugged or abandoned a prior project",
      "product is vaporware: no working app, no GitHub, no verifiable users",
      "token conduct: insider/team dumping, unlocked liquidity, broken tokenomics promises",
      "scrubbed history: team/advisors/audits removed from the site over time",
      "dormant: the account has gone silent for weeks while the token still trades"
    ],
    sources: [
      "the project website + its Wayback history",
      "GitHub / on-chain contract activity",
      "DexScreener / on-chain token conduct",
      "named team + their track record",
      "backer / partner confirmations",
      "X posting cadence"
    ]
  },
  ["KOL" /* KOL */]: {
    label: "KOL / Promoter",
    lens: "Evaluated against the roster KB and on-chain behaviour. The question is whether their calls create value for followers or extract it.",
    axes: {
      K1_identity_roster: 12,
      K2_call_performance: 30,
      K3_disclosure_deletion: 18,
      K4_onchain_conduct: 20,
      K5_cabal_fud: 20
    },
    caps: { wallet_sold_into_promo: 35, paid_to_shill_confirmed_rug: 25 },
    flags: [
      "calls cluster at local price tops (exit-liquidity behaviour)",
      "a paid KOL cabal amplifying a token that then collapsed to zero, where the team had clear motive and means to use that social capital to exit (the rug-fuel pattern). A routine launch campaign on a project that did not rug is NOT itself a flag",
      "deleted promotional posts after a token failed",
      "undisclosed paid promotion",
      "selling into one's own calls (wallet evidence)"
    ],
    sources: [
      "ARGUS roster KB",
      "associated/smart wallets",
      "DexScreener/CoinGecko per token",
      "cabal graph",
      "ZachXBT and investigator corpus",
      "X history + archive"
    ]
  },
  ["INVESTOR" /* INVESTOR */]: {
    label: "Venture Capital / Fund",
    lens: "Evaluated against fund databases and the reality of claimed relationships. The question is whether the track record and endorsements are real.",
    axes: {
      I1_identity_legitimacy: 15,
      I2_portfolio_quality: 25,
      I3_fund_scale_tier: 15,
      I4_testimonial_corroboration: 20,
      I5_reputation_fud: 25
    },
    caps: { contradicted_testimonial: 15, predatory_terms_verified: 35 },
    flags: [
      "identity fraud or impersonation (NOT mere pseudonymity, which is normal)",
      "claimed portfolio bought on the open market and presented as venture entries",
      "website testimonials that the named endorsers never publicly acknowledge",
      "claimed exits that cannot be corroborated",
      "press footprint that is entirely paid distribution with no organic coverage"
    ],
    sources: [
      "Pitchbook",
      "Crunchbase",
      "AngelList",
      "the fund's own site/testimonials",
      "X accounts of every named endorser and portfolio project",
      "LP/founder commentary",
      "investigator corpus"
    ]
  },
  ["AGENCY" /* AGENCY */]: {
    label: "Agency / Contractor",
    lens: "Evaluated as a service contractor, not a principal. The question is whether their services are legitimate growth or manufactured manipulation.",
    axes: {
      AG1_identity_legitimacy: 15,
      AG2_client_outcomes: 25,
      AG3_service_integrity: 25,
      AG4_reputation_fud: 35
    },
    caps: { market_manipulation_services: 10 },
    flags: [
      "documented community FUD on the agency",
      "services that amount to wash trading, bot engagement, or coordinated raids",
      "client roster dominated by rugs or failed launches",
      "anonymous operators behind a paid service",
      "fake engagement or follower inflation as a product"
    ],
    sources: [
      "agency site and case studies",
      "client project outcomes",
      "community FUD threads",
      "investigator corpus",
      "engagement-authenticity checks"
    ]
  },
  ["ADVISOR" /* ADVISOR */]: {
    label: "Advisor / Board",
    lens: "Evaluated on the projects they have lent their name to and whether those relationships are real. The question is whether the advisory record is credibility or liability.",
    axes: {
      AD1_identity_verifiability: 12,
      AD2_advised_outcomes: 28,
      AD3_relationship_corroboration: 25,
      AD4_advisory_conduct: 20,
      AD5_reputation_fud: 15
    },
    caps: { claimed_advisory_contradicted: 15, advised_rug_with_allocation: 25 },
    flags: [
      "advised projects that later rugged, especially with a token allocation",
      "advisory claims the named projects have never publicly acknowledged",
      "dumping advisory token allocations into retail",
      "a long advisory list with no verifiable contribution to any of it"
    ],
    sources: [
      "the subject's own advisory claims",
      "each advised project's site and X",
      "advised-project outcomes",
      "token-allocation and vesting disclosures",
      "investigator corpus"
    ]
  },
  ["MEMBER" /* MEMBER */]: {
    label: "Community Member / Ambassador / Moderator",
    lens: "Low-stakes profile. The question is whether the contribution is authentic participation or astroturf.",
    axes: {
      ME1_identity: 25,
      ME2_role_authenticity: 35,
      ME3_conduct_reputation: 40
    },
    caps: {},
    flags: [
      "sockpuppet or astroturf participation",
      "coordinated shilling disguised as organic community voice"
    ],
    sources: ["platform activity", "ARGUS roster KB", "community context"]
  }
};
function getProfile(subjectClass) {
  return PROFILES[subjectClass];
}
var AXIS_TO_CLASS = {};
for (const cls of Object.keys(PROFILES)) {
  for (const ax of Object.keys(PROFILES[cls].axes)) {
    AXIS_TO_CLASS[ax] = cls;
  }
}
function classForAxis(axis) {
  return AXIS_TO_CLASS[axis];
}
function effectiveCaps(subjectClass) {
  return { ...SHARED_CAPS, ...getProfile(subjectClass).caps };
}

// src/engine/corroboration.ts
function classifyTestimonial(obs) {
  const ack = (obs.public_acknowledgment ?? "none").toLowerCase();
  const rel = obs.relationship_corroborated;
  const follows = obs.follows_subject;
  const sentiment = (obs.sentiment ?? "none").toLowerCase();
  const fud = Boolean(obs.fud_present);
  if (fud || sentiment === "negative") return "Contradicted" /* CONTRADICTED */;
  if ((ack === "endorsement" || ack === "thanks") && rel)
    return "Corroborated" /* CORROBORATED */;
  if (ack === "mention" || ack === "thanks" || ack === "endorsement" || follows)
    return "PartiallyCorroborated" /* PARTIAL */;
  return "Unconfirmed" /* UNCONFIRMED */;
}
var VERDICT_WEIGHT = {
  ["Corroborated" /* CORROBORATED */]: 1,
  ["PartiallyCorroborated" /* PARTIAL */]: 0.5,
  ["Unconfirmed" /* UNCONFIRMED */]: 0.1,
  ["Contradicted" /* CONTRADICTED */]: 0
};
function scoreAxis(testimonials, axisWeight) {
  if (!testimonials.length) {
    return [axisWeight * 0.5, { claims: 0 }, null];
  }
  const verdicts = testimonials.map((t) => t.corroboration_verdict);
  const counts = {
    ["Corroborated" /* CORROBORATED */]: 0,
    ["PartiallyCorroborated" /* PARTIAL */]: 0,
    ["Unconfirmed" /* UNCONFIRMED */]: 0,
    ["Contradicted" /* CONTRADICTED */]: 0
  };
  for (const v of verdicts) counts[v] += 1;
  const meanW = verdicts.reduce((a, v) => a + VERDICT_WEIGHT[v], 0) / verdicts.length;
  let score = axisWeight * meanW;
  if (counts["Unconfirmed" /* UNCONFIRMED */] >= Math.max(1, verdicts.length / 2)) {
    score = Math.min(score, axisWeight * 0.25);
  }
  const cap = counts["Contradicted" /* CONTRADICTED */] > 0 ? "contradicted_testimonial" : null;
  const summary = {
    claims: verdicts.length,
    corroborated: counts["Corroborated" /* CORROBORATED */],
    partial: counts["PartiallyCorroborated" /* PARTIAL */],
    unconfirmed: counts["Unconfirmed" /* UNCONFIRMED */],
    contradicted: counts["Contradicted" /* CONTRADICTED */]
  };
  return [Math.round(score * 100) / 100, summary, cap];
}

// src/engine/router.ts
var PATTERNS = {
  // Professional capital allocation only. Bare "investing"/"angel" bio talk is
  // retail/KOL noise, not a fund — those words deliberately do NOT score here.
  ["INVESTOR" /* INVESTOR */]: [
    /\bventure\b/i,
    /\bcapital\b/i,
    /\bVC\b/i,
    /\bfund\b/i,
    /\bGP\b/i,
    /\bgeneral partner\b/i,
    /\blimited partner\b/i,
    /\bportfolio\b/i,
    /\bangel investor\b/i,
    /\blaunchpad\b/i,
    /\baccelerator\b/i
  ],
  ["FOUNDER" /* FOUNDER */]: [
    /\bfounder\b/i,
    /\bco-?founder\b/i,
    /\bCEO\b/i,
    /\bCTO\b/i,
    /\bbuilding\b/i,
    /\bbuilder\b/i,
    /\bwe'?re building\b/i,
    /\bcreator of\b/i,
    /\bfounded\b/i
  ],
  // A project/protocol's OWN brand account: an organization, not a person. Uses
  // "we/our", describes one product/token it ships. Distinct from a KOL (who
  // promotes OTHERS' tokens) and a founder (an individual).
  ["PROJECT" /* PROJECT */]: [
    /\bprotocol\b/i,
    /\bnetwork\b/i,
    /\bdApp\b/i,
    /\becosystem\b/i,
    /\bDAO\b/i,
    /\b(?:prediction|betting|forecasting) market\b/i,
    /\b(?:decentralized )?exchange\b/i,
    /\bmarketplace\b/i,
    // "Product" is a useful brand-account signal, but not when it is plainly a
    // person's job title. Server routing additionally requires the resolved X
    // profile to link a credible official site before PROJECT can govern.
    /\bproduct\b(?!\s+(?:manager|management|lead|leader|designer|design|engineer|engineering|marketing|marketer|growth|strategy|strategist|ops|operations|at)\b)/i,
    /\bplatform\b/i,
    /\bthe official\b/i,
    /\bofficial account\b/i,
    /\bwe'?re building\b/i,
    /\bour (?:token|protocol|platform|app|mission|community)\b/i,
    /\b\$[A-Z]{2,6} token\b/i,
    /\bpowered by\b/i,
    /\bmainnet\b/i,
    /\btestnet\b/i
  ],
  ["ADVISOR" /* ADVISOR */]: [
    /\badvisor\b/i,
    /\badviser\b/i,
    /\badvisory\b/i,
    /\bboard member\b/i,
    /\bstrategic advisor\b/i,
    /\bmentor\b/i
  ],
  ["AGENCY" /* AGENCY */]: [
    /\bagency\b/i,
    /\bgrowth\b/i,
    /\bmarketing\b/i,
    /\bwe help projects\b/i,
    /\bKOL management\b/i,
    /\bmarket making\b/i,
    /\bmarket maker\b/i,
    /\bPR\b/i,
    /\bservices\b/i,
    /\bclients\b/i
  ],
  ["KOL" /* KOL */]: [
    /\balpha\b/i,
    /\bcalls?\b/i,
    /\btrader\b/i,
    /\binfluencer\b/i,
    /\bgems?\b/i,
    /\bdegen\b/i,
    /\bsignals?\b/i,
    /\bshill\b/i,
    /\bcaller\b/i
  ],
  ["MEMBER" /* MEMBER */]: [
    /\bambassador\b/i,
    /\bmod\b/i,
    /\bmoderator\b/i,
    /\bcommunity\b/i,
    /\bcontributor\b/i
  ]
};
function classifySubject(bio = "", kb = null, selfLabel = null) {
  const text2 = (bio || "").toLowerCase();
  const scores = Object.fromEntries(
    Object.values(SubjectClass).map((c) => [c, 0])
  );
  for (const cls of Object.keys(PATTERNS)) {
    for (const p of PATTERNS[cls]) {
      if (p.test(text2)) scores[cls] += 1;
    }
  }
  const rationale = [];
  if (kb?.kb_hit) {
    scores["KOL" /* KOL */] += 2;
    rationale.push("present in KOL roster KB (strong KOL prior)");
  }
  if (kb?.roster_hit) {
    scores["KOL" /* KOL */] += 1;
    rationale.push("appears on a paid roster with pricing");
  }
  if (selfLabel != null) {
    const labels = Array.isArray(selfLabel) ? selfLabel : [selfLabel];
    const roles = [];
    for (const lbl of labels) {
      if (Object.values(SubjectClass).includes(lbl)) {
        roles.push(lbl);
      }
    }
    if (roles.length) {
      return {
        subject_class: roles[0],
        applicable_classes: roles,
        confidence: "operator-set",
        rationale: "roles set explicitly by operator",
        scores
      };
    }
  }
  const applicable = Object.keys(scores).filter((c) => scores[c] > 0).sort((a, b) => scores[b] - scores[a]);
  if (!applicable.length) {
    return {
      subject_class: null,
      applicable_classes: [],
      confidence: "none",
      rationale: "no classifying signal; operator must set the role set",
      scores
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
    scores
  };
}

// src/engine/audit.ts
var VERDICT_BANDS = [
  ["PASS", 70, 100],
  ["CAUTION", 40, 69],
  ["FAIL", 0, 39]
];
var SEVERITY = {
  AVOID: 5,
  UNVERIFIABLE_IDENTITY: 4,
  FAIL: 3,
  CAUTION: 2,
  PASS: 1,
  INCOMPLETE: 0
};
var _counter = 0;
function makeAuditId(handle) {
  _counter += 1;
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `PA-${uuid.replace(/-/g, "").slice(0, 20).toUpperCase()}`;
  const seed = `${handle}:${Date.now()}:${_counter}:${Math.random()}`;
  const h = seed.split("").reduce((value, char) => value * 33 + char.charCodeAt(0) >>> 0, 5381);
  return `PA-${Date.now().toString(36).toUpperCase()}-${h.toString(16).toUpperCase().padStart(8, "0")}`;
}
function asClass(x) {
  return x;
}
var Audit = class {
  handle;
  roles;
  subject_class;
  audit_id;
  axisScores = {};
  identity = null;
  display_name;
  ventures = [];
  testimonials = [];
  advisedProjects = [];
  clientEngagements = [];
  wallets = [];
  promotions = [];
  associates = [];
  findings = [];
  finalizedAt;
  constructor(handle, opts = {}) {
    this.handle = normalizeHandle(handle);
    if (opts.roles) this.roles = opts.roles.map(asClass);
    else if (opts.subject_class != null) this.roles = [asClass(opts.subject_class)];
    else this.roles = [];
    this.subject_class = this.roles[0] ?? null;
    this.display_name = opts.display_name;
    this.audit_id = makeAuditId(this.handle);
  }
  setIdentity(confidence) {
    this.identity = confidence;
  }
  addVenture(v) {
    this.ventures.push(v);
  }
  addWallet(w) {
    this.wallets.push(w);
  }
  addPromotion(p) {
    this.promotions.push(p);
  }
  addAssociate(a) {
    const { associate_handle, ...rest } = a;
    this.associates.push({ ...rest, associate_key: normalizeHandle(associate_handle) });
  }
  addFinding(f) {
    this.findings.push(f);
  }
  addTestimonial(t) {
    const verdict = classifyTestimonial(t);
    this.testimonials.push({ ...t, corroboration_verdict: verdict });
    return verdict;
  }
  addAdvisedProject(p) {
    const verdict = classifyTestimonial(p);
    this.advisedProjects.push({ ...p, corroboration_verdict: verdict });
    return verdict;
  }
  addClientEngagement(c) {
    this.clientEngagements.push(c);
  }
  getAssociates() {
    return this.associates;
  }
  getVentures() {
    return this.ventures;
  }
  getTestimonials() {
    return this.testimonials;
  }
  getAdvisedProjects() {
    return this.advisedProjects;
  }
  getWallets() {
    return this.wallets;
  }
  getPromotions() {
    return this.promotions;
  }
  getClientEngagements() {
    return this.clientEngagements;
  }
  getFindings() {
    return this.findings;
  }
  founderSummary() {
    const outcomes = this.ventures.map((v) => v.outcome);
    return {
      pattern: classifyFounderPattern(outcomes),
      repeat_backing: repeatBackingSignal(
        this.ventures.map((v) => ({
          outcome: v.outcome,
          acquirer: v.acquirer ?? null,
          investors: v.investors ?? [],
          current_backers: v.current_backers ?? []
        }))
      )
    };
  }
  advisedOutcomeSummary() {
    const rows = this.advisedProjects;
    return {
      advised: rows.length,
      rugs: rows.filter((r) => r.project_outcome === "Rug").length,
      rugs_with_allocation: rows.filter((r) => r.project_outcome === "Rug" && r.paid_or_allocated).length,
      successes: rows.filter((r) => r.project_outcome === "IPO" || r.project_outcome === "Acquisition").length
    };
  }
  setAxis(axis, score, rationale = "", lineage = {}) {
    const role = classForAxis(axis);
    if (!this.roles.includes(role)) {
      throw new Error(`axis ${axis} belongs to ${role}, not a held role`);
    }
    const w = getProfile(role).axes[axis];
    if (!Number.isFinite(score)) throw new Error(`axis ${axis} score must be finite`);
    this.axisScores[axis] = {
      score: Math.max(0, Math.min(score, w)),
      weight: w,
      rationale,
      role,
      ...lineage.evidenceRefs ? { evidenceRefs: [...lineage.evidenceRefs] } : {},
      ...lineage.counterEvidenceRefs ? { counterEvidenceRefs: [...lineage.counterEvidenceRefs] } : {},
      ...lineage.gaps ? { gaps: [...lineage.gaps] } : {}
    };
  }
  corroborationAxis(axis = "I4_testimonial_corroboration") {
    const w = getProfile("INVESTOR" /* INVESTOR */).axes[axis];
    return scoreAxis(
      this.testimonials.map((t) => ({ corroboration_verdict: t.corroboration_verdict })),
      w
    );
  }
  advisoryCorroborationAxis(axis = "AD3_relationship_corroboration") {
    const w = getProfile("ADVISOR" /* ADVISOR */).axes[axis];
    return scoreAxis(
      this.advisedProjects.map((t) => ({ corroboration_verdict: t.corroboration_verdict })),
      w
    );
  }
  sharedCapsTriggered() {
    const keys = [];
    const has = (ftype, status, n = 1) => this.findings.some(
      (f) => this.findingTargetsSubject(f) && f.finding_type === ftype && f.verification_status === status && f.independent_source_count >= n && this.findingHasVerifiedArtifact(f)
    );
    if (has("DeceptionFinding", "Verified")) keys.push("deception_confirmed");
    if (has("InvestigatorCallout", "Verified", 2)) keys.push("investigator_verified_fraud");
    const frozenGraphFinding = (strength) => this.findings.some((finding) => {
      const graph = finding.trust_graph;
      const tieKey = typeof graph?.tie_key === "string" ? graph.tie_key.trim() : "";
      const hardKey = /^(?:code:|email:|wallet:|funder:|mint:|token:|ga:|gtm:|adsense:|fbpixel:).+/i.test(tieKey);
      const weakKey = /^(?:holder|amm|dex|pool|lp|market)(?::|$)|^(?:ip|favicon):/i.test(tieKey);
      const tieType = typeof graph?.tie_type === "string" ? graph.tie_type.trim() : "";
      const relationshipEdges = /* @__PURE__ */ new Set([
        "TEAM",
        "WORKED_ON",
        "ASSOCIATES_WITH",
        "FOUNDED",
        "ADVISED",
        "SERVICED",
        "CLAIMED_ENDORSEMENT"
      ]);
      const hasRelationshipEdge = (value) => Array.isArray(value) && value.some((edgeType) => typeof edgeType === "string" && relationshipEdges.has(edgeType));
      const personTie = tieType === "Person" && hasRelationshipEdge(graph?.subject_edge_types) && hasRelationshipEdge(graph?.other_edge_types);
      const domainTie = /^(?:Domain|Website)$/i.test(tieType) && /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(tieKey) && Array.isArray(graph?.subject_edge_types) && graph.subject_edge_types.includes("LINKS") && Array.isArray(graph?.other_edge_types) && graph.other_edge_types.includes("LINKS");
      const exactStrength = strength === "hard" ? hardKey && tieType.length > 0 : tieKey.length > 0 && !hardKey && !weakKey && (personTie || domainTie);
      const validEdgeTypes = (value) => Array.isArray(value) && value.length > 0 && value.every((edgeType) => typeof edgeType === "string" && edgeType.trim().length > 0);
      return this.findingTargetsSubject(finding) && finding.finding_type === "TrustGraphConnection" && finding.verification_status === "Verified" && finding.independent_source_count >= 1 && finding.evidence_origin === "deterministic" && finding.artifact_verified === true && typeof finding.content_hash === "string" && /^[a-f0-9]{64}$/i.test(finding.content_hash) && graph?.tie_strength === strength && exactStrength && validEdgeTypes(graph?.subject_edge_types) && validEdgeTypes(graph?.other_edge_types) && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(graph.other_report_version_id) && graph.other_attestation === "server_collected" && graph.other_completeness === "complete" && (graph.other_verdict === "FAIL" || graph.other_verdict === "AVOID");
    });
    if (frozenGraphFinding("hard")) keys.push("trust_graph_hard_link");
    if (frozenGraphFinding("medium")) keys.push("trust_graph_medium_link");
    return keys;
  }
  artifactIsEligible(url, origin, artifactVerified) {
    if (origin === "model_lead" || artifactVerified === false) return false;
    return !!url && /^https?:\/\/[^\s]+$/i.test(url);
  }
  findingHasVerifiedArtifact(f) {
    return this.artifactIsEligible(f.source_url, f.evidence_origin, f.artifact_verified);
  }
  findingTargetsSubject(f) {
    const scope = f.finding_scope;
    if (!scope) return true;
    if (scope.scope !== "direct_subject" || scope.relationship_to_subject !== "self") return false;
    try {
      return normalizeHandle(scope.target_entity_key) === this.handle;
    } catch {
      return false;
    }
  }
  roleCapsTriggered(role) {
    const keys = [];
    if (role === "FOUNDER" /* FOUNDER */) {
      if (this.ventures.some(
        (v) => v.outcome === "Rug" /* RUG */ && v.evidence_origin !== "model_lead" && v.artifact_verified !== false
      )) keys.push("prior_rug_as_principal");
      if (this.findings.some((f) => this.findingTargetsSubject(f) && f.finding_type === "ManipulationTooling" && f.verification_status === "Verified" && this.findingHasVerifiedArtifact(f)))
        keys.push("operates_manipulation_tooling");
    } else if (role === "KOL" /* KOL */) {
      if (this.wallets.some(
        (w) => w.sold_into_own_promo && (w.link_tier === "SelfDoxxed" || w.link_tier === "InvestigatorAttributed") && w.evidence_origin !== "model_lead" && w.artifact_verified !== false
      ))
        keys.push("wallet_sold_into_promo");
      if (this.promotions.some(
        (p) => p.paid_promo && p.outcome_was_rug && p.evidence_origin !== "model_lead" && p.artifact_verified !== false
      ))
        keys.push("paid_to_shill_confirmed_rug");
    } else if (role === "INVESTOR" /* INVESTOR */) {
      if (this.testimonials.some(
        (t) => t.corroboration_verdict === "Contradicted" /* CONTRADICTED */ && t.evidence_origin !== "model_lead" && t.artifact_verified !== false
      ))
        keys.push("contradicted_testimonial");
      if (this.findings.some((f) => this.findingTargetsSubject(f) && f.finding_type === "PredatoryTerms" && f.verification_status === "Verified" && this.findingHasVerifiedArtifact(f)))
        keys.push("predatory_terms_verified");
    } else if (role === "ADVISOR" /* ADVISOR */) {
      if (this.advisedProjects.some(
        (p) => p.corroboration_verdict === "Contradicted" /* CONTRADICTED */ && p.evidence_origin !== "model_lead" && p.artifact_verified !== false
      ))
        keys.push("claimed_advisory_contradicted");
      if (this.advisedProjects.some(
        (p) => p.project_outcome === "Rug" && p.paid_or_allocated && p.evidence_origin !== "model_lead" && p.artifact_verified !== false
      ))
        keys.push("advised_rug_with_allocation");
    } else if (role === "AGENCY" /* AGENCY */) {
      if (this.clientEngagements.some((c) => c.manipulation_service_flag && this.artifactIsEligible(c.evidence_url, c.evidence_origin, c.artifact_verified)))
        keys.push("market_manipulation_services");
    }
    return keys;
  }
  identityBlocks() {
    return this.identity === "SuspectedImpersonation";
  }
  finalize() {
    const finalizedAt = this.finalizedAt ?? (this.finalizedAt = (/* @__PURE__ */ new Date()).toISOString());
    const identity = this.identity;
    const sharedKeys = this.sharedCapsTriggered();
    const identityBonus = identity ? DOX_BONUS[identity] ?? 0 : 0;
    const roleReports = [];
    for (const role of this.roles) {
      const doxBonus = role === "PROJECT" /* PROJECT */ ? 0 : identityBonus;
      const axes = {};
      for (const [ax, a] of Object.entries(this.axisScores)) {
        if (classForAxis(ax) === role) axes[ax] = a;
      }
      const expectedAxes = Object.keys(getProfile(role).axes);
      const complete = expectedAxes.every((axis) => axes[axis] && Number.isFinite(axes[axis].score));
      if (!complete || Object.keys(axes).length !== expectedAxes.length) {
        roleReports.push({
          role,
          verdict: "INCOMPLETE",
          raw_total: null,
          score_total: null,
          cap_applied: null,
          dox_bonus: doxBonus,
          axes
        });
        continue;
      }
      const raw = Math.round(Object.values(axes).reduce((a, x) => a + x.score, 0));
      const base = raw + doxBonus;
      const caps = effectiveCaps(role);
      const triggered = [
        ...this.roleCapsTriggered(role).map((k) => [caps[k], k]),
        ...sharedKeys.map((k) => [SHARED_CAPS[k], k])
      ];
      let ceiling = null;
      let applied = null;
      let total;
      if (triggered.length) {
        [ceiling, applied] = triggered.reduce((m, c) => c[0] < m[0] ? c : m);
        total = Math.min(base, ceiling);
      } else {
        total = Math.min(100, base);
      }
      let verdict;
      let published;
      if (this.identityBlocks()) {
        verdict = "UNVERIFIABLE_IDENTITY";
        published = null;
      } else if (applied && ceiling <= 10) {
        verdict = "AVOID";
        published = total;
      } else {
        published = total;
        verdict = VERDICT_BANDS.find(([, lo, hi]) => lo <= total && total <= hi)[0];
      }
      roleReports.push({
        role,
        axes,
        raw_total: raw,
        dox_bonus: doxBonus,
        cap_applied: applied,
        score_total: published,
        verdict
      });
    }
    const scored = roleReports.filter((r) => r.verdict !== "INCOMPLETE");
    let composite = "INCOMPLETE";
    let govRole = null;
    let govScore = null;
    let govCap = null;
    if (scored.length === roleReports.length && roleReports.length > 0) {
      const governing = scored.reduce((current, candidate) => {
        const candidateSeverity = SEVERITY[candidate.verdict];
        const currentSeverity = SEVERITY[current.verdict];
        if (candidateSeverity !== currentSeverity) return candidateSeverity > currentSeverity ? candidate : current;
        const candidateScore = candidate.score_total;
        const currentScore = current.score_total;
        if (candidateScore != null && currentScore != null && candidateScore !== currentScore) {
          return candidateScore < currentScore ? candidate : current;
        }
        return current;
      });
      composite = governing.verdict;
      govRole = governing.role;
      govScore = governing.score_total;
      govCap = governing.cap_applied;
    }
    const report = {
      audit_id: this.audit_id,
      handle: this.handle,
      roles: this.roles,
      identity_confidence: identity,
      role_reports: roleReports,
      composite_verdict: composite,
      governing_role: govRole,
      governing_score: govScore,
      verdict: composite,
      score_total: govScore,
      cap_applied: govCap,
      publishable_findings: this.publishable(),
      investigative_leads: this.investigativeLeads(),
      finalized_at: finalizedAt
    };
    if (this.roles.includes("FOUNDER" /* FOUNDER */)) report.founder_summary = this.founderSummary();
    if (this.roles.includes("ADVISOR" /* ADVISOR */)) report.advised_summary = this.advisedOutcomeSummary();
    return report;
  }
  publishable() {
    return this.findings.filter(
      (f) => this.findingTargetsSubject(f) && f.evidence_origin !== "model_lead" && f.artifact_verified !== false && f.independent_source_count >= 1 && (f.verification_status === "Verified" || f.verification_status === "Reported")
    );
  }
  investigativeLeads() {
    return this.findings.filter(
      (f) => f.evidence_origin === "model_lead" || !this.findingTargetsSubject(f)
    );
  }
  toPanoptes() {
    const projectSubject = this.roles.length === 1 && this.roles[0] === "PROJECT" /* PROJECT */;
    const nodes = [{
      type: projectSubject ? "Company" : "Person",
      ...projectSubject ? { subtype: "Project" } : {},
      key: this.handle,
      roles: this.roles,
      subject: true
    }];
    const edges = [];
    for (const a of this.associates) {
      nodes.push({ type: "Person", key: a.associate_key, in_cabal_kb: !!a.in_cabal_kb });
      edges.push({ src: this.handle, dst: a.associate_key, type: "ASSOCIATES_WITH", relation: a.relation });
    }
    for (const v of this.ventures) {
      const key = canonicalEntityKey({ handle: v.x_handle, domain: v.domain, name: v.project_name });
      nodes.push({ type: "Company", key, label: v.project_name, outcome: v.outcome });
      const role = (v.role ?? "").toLowerCase();
      const edgeType = /\b(?:founder|co-?founder|founding team)\b/.test(role) ? "FOUNDED" : /\b(?:investor|backer|angel investor|limited partner)\b|\binvested in\b/.test(role) ? "INVESTED_IN" : /advisor|adviser|board/.test(role) ? "ADVISED" : "WORKED_ON";
      edges.push({ src: this.handle, dst: key, type: edgeType, role: v.role, outcome: v.outcome });
    }
    for (const p of this.promotions) {
      const key = p.contract_address || "$" + (p.ticker ?? "").replace(/^\$+/, "");
      nodes.push({ type: "Company", key, was_rug: !!p.outcome_was_rug });
      edges.push({ src: this.handle, dst: key, type: "PROMOTED" });
    }
    for (const t of this.testimonials) {
      if (t.claimed_endorser_handle) {
        nodes.push({ type: "Person", key: t.claimed_endorser_handle });
        edges.push({
          src: t.claimed_endorser_handle,
          dst: this.handle,
          type: "CLAIMED_ENDORSEMENT",
          verdict: t.corroboration_verdict,
          claimed_relation: t.claimed_relationship
        });
      }
    }
    for (const p of this.advisedProjects) {
      const key = canonicalEntityKey({ handle: p.project_handle, name: p.project_name });
      nodes.push({ type: "Company", key, label: p.project_name, outcome: p.project_outcome });
      edges.push({ src: this.handle, dst: key, type: "ADVISED", verdict: p.corroboration_verdict, outcome: p.project_outcome });
    }
    for (const c of this.clientEngagements) {
      nodes.push({ type: "Company", key: c.client_name });
      edges.push({ src: this.handle, dst: c.client_name, type: "SERVICED", manipulation: !!c.manipulation_service_flag });
    }
    for (const w of this.wallets) {
      const key = `${w.chain}:${w.address}`;
      nodes.push({ type: "Identity", subtype: "Wallet", key, link_tier: w.link_tier });
      edges.push({ src: this.handle, dst: key, type: "CONTROLS_WALLET", tier: w.link_tier });
    }
    for (const f of this.findings.filter((x) => this.findingTargetsSubject(x) && x.finding_type === "DeceptionFinding")) {
      const key = "DF-" + f.claim.slice(0, 10);
      nodes.push({ type: "DeceptionFinding", key, claim: f.claim });
      edges.push({ src: key, dst: this.handle, type: "FLAGS", permanent: true });
    }
    return { nodes, edges };
  }
};
var HANDLE_TAIL = /@?([A-Za-z0-9_]{2,30})$/;
function normalizeHandle(raw) {
  raw = raw.trim();
  const url = raw.match(/(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{2,30})/i);
  if (url) return "@" + url[1].toLowerCase();
  const m = raw.match(HANDLE_TAIL);
  if (m) return "@" + m[1].toLowerCase();
  throw new Error(`cannot normalize handle: ${raw}`);
}
function canonicalEntityKey(opts) {
  const h = (opts.handle ?? "").replace(/^@/, "").trim().toLowerCase();
  if (/^[a-z0-9_]{2,30}$/.test(h)) return "@" + h;
  const d = (opts.domain ?? "").replace(/^https?:\/\//i, "").replace(/^www\./, "").replace(/\/.*$/, "").trim().toLowerCase();
  if (d && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) return d;
  return (opts.name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

// src/data/dossier.ts
function assembleDossier(ev, live) {
  const a = new Audit(ev.profile.handle, { roles: ev.roles, display_name: ev.profile.display_name });
  const graphAudit = new Audit(ev.profile.handle, { roles: ev.roles, display_name: ev.profile.display_name });
  a.setIdentity(ev.profile.identity_confidence);
  graphAudit.setIdentity(ev.profile.identity_confidence);
  const governingEligible = (row) => row.evidence_origin !== "model_lead" && row.artifact_verified !== false;
  const meaningfulTeamValue = (value) => Boolean(value.trim()) && !/^(?:<\s*)?(?:unknown|n\/a|null|undefined)(?:\s*>)?$/i.test(value.trim());
  const identityGrounded = (row) => meaningfulTeamValue(row.name) && meaningfulTeamValue(row.role) && row.evidence_origin !== "model_lead" && row.artifact_verified === true;
  const groundedWebTeam = (ev.webTeam ?? []).filter(identityGrounded).map((member) => ({
    ...member,
    ...member.identity_link_evidence_origin === "model_lead" ? { handle: void 0, linkedin: void 0 } : {},
    ...member.projects_evidence_origin === "model_lead" ? { projects: [] } : {}
  }));
  const webTeamLeads = (ev.webTeam ?? []).flatMap((member) => {
    if (!meaningfulTeamValue(member.name) || !meaningfulTeamValue(member.role)) return [];
    if (!identityGrounded(member)) return [{ ...member }];
    if (member.identity_link_evidence_origin !== "model_lead" && member.projects_evidence_origin !== "model_lead") return [];
    return [{
      ...member,
      evidence_origin: "model_lead",
      artifact_verified: false,
      provider: "grok",
      source: `${member.source} \xB7 unverified model-enriched links`
    }];
  });
  ev.ventures.forEach((v) => {
    a.addVenture(v);
    if (governingEligible(v)) graphAudit.addVenture(v);
  });
  ev.testimonials.forEach((t) => {
    a.addTestimonial(t);
    if (governingEligible(t)) graphAudit.addTestimonial(t);
  });
  ev.advised.forEach((p) => {
    a.addAdvisedProject(p);
    if (governingEligible(p)) graphAudit.addAdvisedProject(p);
  });
  ev.wallets.forEach((w) => {
    a.addWallet(w);
    if (governingEligible(w)) graphAudit.addWallet(w);
  });
  ev.promotions.forEach((p) => {
    a.addPromotion(p);
    if (governingEligible(p)) graphAudit.addPromotion(p);
  });
  ev.clientEngagements.forEach((c) => {
    a.addClientEngagement(c);
    if (governingEligible(c)) graphAudit.addClientEngagement(c);
  });
  ev.associates.forEach((as) => {
    a.addAssociate(as);
    if (governingEligible(as)) graphAudit.addAssociate(as);
  });
  ev.findings.forEach((f) => {
    a.addFinding(f);
    if (governingEligible(f)) graphAudit.addFinding(f);
  });
  ev.axes.forEach((ax) => {
    try {
      a.setAxis(ax.axis, ax.score, ax.rationale, {
        evidenceRefs: ax.evidenceRefs,
        counterEvidenceRefs: ax.counterEvidenceRefs,
        gaps: ax.gaps
      });
    } catch {
    }
  });
  const report = a.finalize();
  const graph = graphAudit.toPanoptes();
  const subjectKey = graph.nodes.find((n) => n.subject)?.key ?? ev.profile.handle;
  const hasNode = (key) => graph.nodes.some((n) => String(n.key).toLowerCase() === key.toLowerCase());
  for (const p of groundedWebTeam) {
    const verifiedHandle = p.identity_link_evidence_origin === "model_lead" ? void 0 : p.handle;
    const verifiedProjects = p.projects_evidence_origin === "model_lead" ? [] : p.projects ?? [];
    if (!verifiedHandle && !p.name) continue;
    const pkey = canonicalEntityKey({ handle: verifiedHandle, name: p.name });
    if (!pkey) continue;
    if (!hasNode(pkey)) graph.nodes.push({ type: "Person", key: pkey, label: p.name, role: p.role });
    graph.edges.push({ src: subjectKey, dst: pkey, type: "TEAM", role: p.role });
    for (const pr of verifiedProjects) {
      if (!pr.name) continue;
      const prKey = canonicalEntityKey({ name: pr.name });
      if (!prKey) continue;
      if (!hasNode(prKey)) graph.nodes.push({ type: "Company", key: prKey, label: pr.name });
      graph.edges.push({ src: pkey, dst: prKey, type: "WORKED_ON", role: pr.role });
    }
  }
  for (const vt of ev.ventureTeams ?? []) {
    if (!governingEligible(vt)) continue;
    if (!vt.key) continue;
    if (!hasNode(vt.key)) graph.nodes.push({ type: "Company", key: vt.key, label: vt.name });
    for (const person of vt.people) {
      const pk = canonicalEntityKey({ handle: person.handle, name: person.name });
      if (!pk) continue;
      if (!hasNode(pk)) graph.nodes.push({ type: "Person", key: pk, label: person.name, role: person.role });
      graph.edges.push({ src: pk, dst: vt.key, type: "WORKED_ON", role: person.role });
    }
  }
  for (const relationship of (ev.sourceArtifacts ?? []).filter(
    (artifact) => artifact.kind === "portfolio_relationship" && artifact.match === "relationship_confirmed" && artifact.relationship === "invested_in" && artifact.projectName
  )) {
    const investorKey = relationship.attribution === "affiliated_fund" && relationship.investorEntityName ? canonicalEntityKey({
      handle: relationship.investorEntityHandle,
      domain: relationship.investorEntityDomain,
      name: relationship.investorEntityName
    }) : subjectKey;
    if (investorKey !== subjectKey) {
      if (!hasNode(investorKey)) graph.nodes.push({ type: "Company", key: investorKey, label: relationship.investorEntityName });
      const affiliationExists = graph.edges.some((edge) => edge.src === subjectKey && edge.dst === investorKey && edge.type === "AFFILIATED_WITH");
      if (!affiliationExists) graph.edges.push({
        src: subjectKey,
        dst: investorKey,
        type: "AFFILIATED_WITH",
        context: "portfolio attribution",
        ...relationship.attributionSourceUrl ? { source_url: relationship.attributionSourceUrl } : {}
      });
    }
    const projectKey = canonicalEntityKey({
      handle: relationship.projectHandle,
      domain: relationship.projectDomain,
      name: relationship.projectName
    });
    if (!projectKey) continue;
    if (!hasNode(projectKey)) graph.nodes.push({ type: "Company", key: projectKey, label: relationship.projectName });
    const exists = graph.edges.some((edge) => edge.src === investorKey && edge.dst === projectKey && edge.type === "INVESTED_IN");
    if (!exists) graph.edges.push({
      src: investorKey,
      dst: projectKey,
      type: "INVESTED_IN",
      source_url: relationship.sourceUrl,
      source_class: relationship.sourceClass
    });
  }
  for (const email of ev.profile.identity_emails ?? []) {
    const ekey = `email:${email.toLowerCase()}`;
    if (!hasNode(ekey)) graph.nodes.push({ type: "Identity", subtype: "Email", key: ekey, label: email });
    graph.edges.push({ src: subjectKey, dst: ekey, type: "IDENTITY_EMAIL" });
  }
  return {
    handle: ev.profile.handle,
    display_name: ev.profile.display_name,
    resolved_name: ev.profile.resolved_name,
    avatar: ev.profile.avatar,
    avatar_url: ev.profile.avatar_url,
    bio: ev.profile.bio,
    website: ev.profile.website,
    profile_collection_state: ev.profile.profile_collection_state,
    profile_provider: ev.profile.profile_provider,
    profile_captured_at: ev.profile.profile_captured_at,
    followers: ev.profile.followers,
    joined: ev.profile.joined,
    days_since_post: ev.profile.days_since_post,
    identity_note: ev.profile.identity_note,
    prior_handles: ev.profile.prior_handles,
    headline: ev.headline,
    live,
    ...ev.axisCitationVersion === 1 && ev.axisEvidenceCatalog ? {
      axisCitationVersion: 1,
      axisEvidenceCatalog: ev.axisEvidenceCatalog.map((artifact) => ({
        ...artifact,
        eligibleAxes: [...artifact.eligibleAxes],
        ...artifact.counterEligibleAxes ? { counterEligibleAxes: [...artifact.counterEligibleAxes] } : {}
      })),
      ...ev.projectStrengthBands ? {
        projectStrengthBands: Object.fromEntries(Object.entries(ev.projectStrengthBands).map(([axis, band2]) => [axis, {
          ...band2,
          reasons: [...band2.reasons],
          anchorArtifactIds: [...band2.anchorArtifactIds]
        }]))
      } : {}
    } : {},
    notableFollowers: ev.notableFollowers,
    contradictions: ev.contradictions,
    webTeam: groundedWebTeam,
    ...webTeamLeads.length ? { webTeamLeads } : {},
    ventureTeams: ev.ventureTeams ?? [],
    portfolioLeads: ev.portfolioLeads ?? [],
    sourceArtifacts: ev.sourceArtifacts,
    profileAuthenticity: ev.profileAuthenticity,
    trustGraphScreen: ev.trustGraphScreen,
    projectToken: ev.projectToken ? {
      ...ev.projectToken,
      ...ev.projectToken.providers ? { providers: [...ev.projectToken.providers] } : {},
      ...ev.projectToken.history ? {
        history: { ...ev.projectToken.history, points: [...ev.projectToken.history.points] }
      } : {}
    } : void 0,
    ...ev.basicFacts?.length ? {
      basicFacts: ev.basicFacts.map((fact) => ({
        ...fact,
        ...fact.sources ? { sources: fact.sources.map((source2) => ({ ...source2 })) } : {}
      }))
    } : {},
    ...ev.basicFactLeads?.length ? {
      basicFactLeads: ev.basicFactLeads.map((lead) => ({
        ...lead,
        ...lead.candidateUrls ? { candidateUrls: [...lead.candidateUrls] } : {}
      }))
    } : {},
    ...ev.basicFactQuestionLedger?.length ? {
      basicFactQuestionLedger: ev.basicFactQuestionLedger.map((entry) => ({
        ...entry,
        answerRefs: [...entry.answerRefs],
        providerRuns: entry.providerRuns.map((run) => ({ ...run }))
      }))
    } : {},
    report,
    graph,
    founderSummary: ev.roles.includes("FOUNDER" /* FOUNDER */) ? a.founderSummary() : void 0,
    evidence: {
      ventures: a.getVentures(),
      testimonials: a.getTestimonials(),
      advised: a.getAdvisedProjects(),
      associates: a.getAssociates(),
      wallets: a.getWallets(),
      promotions: a.getPromotions()
    }
  };
}

// src/data/subjects.ts
function toEvidence(f) {
  const a = new Audit(f.handle, { roles: f.roles, display_name: f.display_name });
  a.setIdentity(f.identity);
  f.build(a);
  return {
    profile: {
      handle: f.handle,
      display_name: f.display_name,
      avatar: f.avatar,
      bio: f.bio,
      followers: f.followers,
      joined: f.joined,
      identity_confidence: f.identity,
      identity_note: f.identity_note
    },
    roles: f.roles,
    ventures: a.getVentures(),
    testimonials: a.getTestimonials(),
    advised: a.getAdvisedProjects(),
    wallets: a.getWallets(),
    promotions: a.getPromotions(),
    clientEngagements: a.getClientEngagements(),
    associates: a.getAssociates().map((as) => ({
      associate_handle: as.associate_key,
      relation: as.relation,
      in_cabal_kb: as.in_cabal_kb,
      evidence_url: as.evidence_url,
      notes: as.notes
    })),
    findings: a.getFindings(),
    axes: f.axes,
    headline: f.headline,
    recentActivity: [],
    notableFollowers: [],
    contradictions: [],
    sourceArtifacts: []
  };
}
var lumen = {
  handle: "@0xlumen",
  display_name: "lumen",
  avatar: "\u25CE",
  bio: "founder. building the on-chain future. ex-@meridianlabs (acq). GP @ Lumen Capital. advisor to 9 protocols. opinions are alpha.",
  followers: "184.2K",
  joined: "Mar 2021",
  identity: "Unverified",
  identity_note: "Persistent pseudonym since 2021 with a consistent on-chain footprint. Pseudonymity is not a flag; disclosure would have earned a bonus.",
  roles: ["FOUNDER" /* FOUNDER */, "INVESTOR" /* INVESTOR */, "ADVISOR" /* ADVISOR */],
  headline: "Real building history undercut by a manufactured endorsement wall and a paid advisory seat on a confirmed rug. The advisor role governs.",
  build: (a) => {
    a.addVenture({
      project_name: "Meridian Labs",
      role: "co-founder",
      period: "2019-2022",
      outcome: "Acquisition" /* ACQUISITION */,
      acquirer: "Chainforge",
      deal_type: "strategic",
      deal_value_usd: 28e6,
      investors: ["Variant", "Dragonfly"],
      evidence_url: "https://chainforge.xyz/blog/acquiring-meridian"
    });
    a.addVenture({
      project_name: "Lumen Protocol",
      role: "founder",
      period: "2023-present",
      outcome: "Active" /* ACTIVE */,
      current_backers: ["Dragonfly", "Robot Ventures"],
      evidence_url: "https://github.com/lumen-protocol"
    });
    a.addTestimonial({ claimed_endorser_handle: "@cdixon", claimed_relationship: "portfolio", public_acknowledgment: "none", follows_subject: false, appears_at: "lumencapital.xyz" });
    a.addTestimonial({ claimed_endorser_handle: "@haydenzadams", claimed_relationship: "co-investor", public_acknowledgment: "none", follows_subject: false, appears_at: "lumencapital.xyz" });
    a.addTestimonial({ claimed_endorser_handle: "@StaniKulechov", claimed_relationship: "portfolio", public_acknowledgment: "none", follows_subject: false, appears_at: "lumencapital.xyz" });
    a.addTestimonial({ claimed_endorser_handle: "@gabby", claimed_relationship: "advisor_to_subject", public_acknowledgment: "mention", follows_subject: true, relationship_corroborated: false, appears_at: "lumencapital.xyz" });
    a.addAdvisedProject({ project_name: "Helix Finance", project_handle: "@helixfi", public_acknowledgment: "thanks", relationship_corroborated: true, follows_subject: true, project_outcome: "Active" /* ACTIVE */, paid_or_allocated: true });
    a.addAdvisedProject({
      project_name: "ZenithDAO",
      project_handle: "@zenithdao",
      claimed_role: "strategic advisor",
      public_acknowledgment: "endorsement",
      relationship_corroborated: true,
      follows_subject: true,
      project_outcome: "Rug" /* RUG */,
      paid_or_allocated: true,
      evidence_url: "https://rugpull.report/zenithdao",
      notes: "Token allocation vested to the subject; project drained LP Apr 2024."
    });
    a.addAssociate({ associate_handle: "@cypher_eth", relation: "co-investor", in_cabal_kb: false });
    a.addAssociate({ associate_handle: "@zenithdao", relation: "advised", in_cabal_kb: true });
    a.addAssociate({ associate_handle: "@vexnode", relation: "co-deployer", in_cabal_kb: true });
    a.addFinding({ finding_type: "AdvisoryRug", claim: "Advised ZenithDAO which rugged ~$4.1M while subject held a vested allocation.", source_url: "https://rugpull.report/zenithdao", source_date: "2024-04-18", verification_status: "Verified", independent_source_count: 3, polarity: -1 });
    a.addFinding({ finding_type: "MeridianExit", claim: "Meridian Labs acquired by Chainforge (strategic, ~$28M) in 2022.", source_url: "https://chainforge.xyz/blog/acquiring-meridian", source_date: "2022-09-01", verification_status: "Verified", independent_source_count: 2, polarity: 1 });
  },
  axes: [
    // FOUNDER
    { axis: "F1_identity_verifiability", score: 7, rationale: "Pseudonymous but a stable on-chain identity since 2021; no impersonation." },
    { axis: "F2_track_record", score: 22, rationale: "One verified strategic exit (Meridian \u2192 Chainforge, $28M). Current build is active and real." },
    { axis: "F3_repeat_backing", score: 11, rationale: "Dragonfly backed both Meridian and Lumen, a returning backer from a successful exit (strong signal)." },
    { axis: "F4_build_substance", score: 12, rationale: "Active GitHub org with original commits; shipped product." },
    { axis: "F5_reputation_integrity", score: 11, rationale: "Clean as a builder; the advisory-rug finding is scored under the advisor role." },
    { axis: "F6_network_quality", score: 8, rationale: "Credible co-investors; one cabal-adjacent associate (ZenithDAO)." },
    // INVESTOR
    { axis: "I1_identity_legitimacy", score: 8, rationale: "Lumen Capital has a site but no registry record or named GP beyond the pseudonym." },
    { axis: "I2_portfolio_quality", score: 13, rationale: "A few real positions; several claimed entries unverifiable against Pitchbook/Crunchbase." },
    { axis: "I3_fund_scale_tier", score: 7, rationale: "Self-described fund, no disclosed raise; placed at Angel/SuperAngel tier at most." },
    { axis: "I4_testimonial_corroboration", score: 4, rationale: "4 marquee endorsements; 3 wholly unacknowledged, 1 partial. The wall is manufactured. Axis collapses." },
    { axis: "I5_reputation_fud", score: 14, rationale: "No LP complaints surfaced; some community skepticism about the portfolio claims." },
    // ADVISOR
    { axis: "AD1_identity_verifiability", score: 7, rationale: "Same stable pseudonym." },
    { axis: "AD2_advised_outcomes", score: 9, rationale: "Advisory graveyard: one active (Helix), one confirmed rug (ZenithDAO)." },
    { axis: "AD3_relationship_corroboration", score: 18, rationale: "Both advised projects publicly acknowledge the relationship, confirming that the claims are real." },
    { axis: "AD4_advisory_conduct", score: 8, rationale: "Held a vested allocation in ZenithDAO; allocation conduct around the rug is the concern." },
    { axis: "AD5_reputation_fud", score: 9, rationale: "Named in post-rug community threads about ZenithDAO advisors." }
  ],
  trace: [
    { phase: "P0 \xB7 Intake", label: "Resolve handle", detail: "@0xlumen \u2192 canonical key. Cross-referencing roster KB across 1,204 entries.", tone: "neutral" },
    { phase: "P0 \xB7 Routing", label: "Classify roles", detail: "Bio signals: founder, GP, advisor. Routed to 3 tracks: FOUNDER, INVESTOR, ADVISOR.", tone: "neutral" },
    { phase: "P1 \xB7 Identity", label: "Identity check", detail: "Persistent pseudonym since 2021, consistent on-chain footprint. No impersonation. Scored on merits.", tone: "good" },
    { phase: "Founder", label: "Enumerate ventures", detail: "Meridian Labs \u2192 acquired by Chainforge ($28M strategic). Verified against acquirer press.", source: "chainforge.xyz", tone: "good" },
    { phase: "Founder", label: "Repeat-backing", detail: "Dragonfly backed Meridian (exit) and re-backed Lumen. Strongest positive signal in venture.", tone: "good" },
    { phase: "Investor", label: "Corroborate endorsements", detail: "4 marquee names on the fund site. Checking each against their real X behaviour\u2026", tone: "neutral" },
    { phase: "Investor", label: "Endorsement verdict", detail: "3 of 4 never followed, mentioned, or acknowledged the subject. The wall is unconfirmed. I4 collapses to 4/20.", source: "X API", tone: "warn" },
    { phase: "Advisor", label: "Advisory graveyard", detail: "9 claimed seats \u2192 2 with evidence. Helix: active, acknowledged. ZenithDAO: acknowledged\u2026", tone: "neutral" },
    { phase: "Advisor", label: "ZenithDAO outcome", detail: "ZenithDAO drained LP ~$4.1M Apr 2024. Subject held a vested allocation. Paid-advisor-to-rug cap fires (25).", source: "rugpull.report", tone: "bad" },
    { phase: "Finalize", label: "Govern composite", detail: "FOUNDER and INVESTOR scored on merits; ADVISOR cap governs. Roles never averaged.", tone: "warn" }
  ]
};
var satoshi = {
  handle: "@satoshi_builds",
  display_name: "Mara Voss",
  avatar: "M",
  bio: "Founder & CEO @ Tideglass. Previously founded Northwind (acq. by Stripe) and Loom Data (IPO). Building dev infra. she/her.",
  followers: "92.7K",
  joined: "Jun 2017",
  identity: "Confirmed",
  identity_note: "Doxxed, consistent LinkedIn + press history. Earns the +5 disclosure bonus.",
  roles: ["FOUNDER" /* FOUNDER */],
  headline: "Two real exits, a returning tier-1 backer, and shipped code. A clean, investment-grade founder profile.",
  build: (a) => {
    a.addVenture({ project_name: "Northwind", role: "founder", period: "2014-2018", outcome: "Acquisition" /* ACQUISITION */, acquirer: "Stripe", deal_type: "strategic", deal_value_usd: 64e6, investors: ["Sequoia", "Index"], evidence_url: "https://stripe.com/newsroom/northwind" });
    a.addVenture({ project_name: "Loom Data", role: "co-founder", period: "2018-2021", outcome: "IPO" /* IPO */, investors: ["Index", "a16z"], evidence_url: "https://sec.gov/loomdata-s1" });
    a.addVenture({ project_name: "Tideglass", role: "founder", period: "2022-present", outcome: "Active" /* ACTIVE */, current_backers: ["Sequoia", "Index"], evidence_url: "https://github.com/tideglass" });
    a.addFinding({ finding_type: "Exit", claim: "Northwind acquired by Stripe (2018, strategic).", source_url: "https://stripe.com/newsroom/northwind", source_date: "2018-05-02", verification_status: "Verified", independent_source_count: 4, polarity: 1 });
    a.addFinding({ finding_type: "IPO", claim: "Loom Data IPO'd on NASDAQ (2021).", source_url: "https://sec.gov/loomdata-s1", source_date: "2021-11-10", verification_status: "Verified", independent_source_count: 5, polarity: 1 });
  },
  axes: [
    { axis: "F1_identity_verifiability", score: 12, rationale: "Fully doxxed; consistent decade-long public history." },
    { axis: "F2_track_record", score: 27, rationale: "Two verified exits: Northwind (acq. Stripe) and Loom Data (IPO). No failures, no rug." },
    { axis: "F3_repeat_backing", score: 14, rationale: "Sequoia and Index, backers of both prior wins, re-backed Tideglass. Strong returning-backer signal." },
    { axis: "F4_build_substance", score: 14, rationale: "Active GitHub org, original technical commits, shipped product." },
    { axis: "F5_reputation_integrity", score: 17, rationale: "No litigation, no investigator findings, strong founder references." },
    { axis: "F6_network_quality", score: 11, rationale: "Tier-1 co-founders and backers; no cabal proximity." }
  ],
  trace: [
    { phase: "P0 \xB7 Intake", label: "Resolve handle", detail: "@satoshi_builds \u2192 canonical key. No roster KB hit (not a paid promoter).", tone: "neutral" },
    { phase: "P0 \xB7 Routing", label: "Classify roles", detail: "Bio signals founder/CEO. Single track: FOUNDER.", tone: "neutral" },
    { phase: "P1 \xB7 Identity", label: "Identity check", detail: "Doxxed, decade of consistent press + LinkedIn. Confirmed \u2192 +5 disclosure bonus.", tone: "good" },
    { phase: "Founder", label: "Enumerate ventures", detail: "Northwind \u2192 Stripe (acq.). Loom Data \u2192 IPO. Both verified against primary sources.", source: "sec.gov \xB7 stripe.com", tone: "good" },
    { phase: "Founder", label: "Repeat-backing", detail: "Sequoia + Index backed both wins and re-backed the current company. Strong.", tone: "good" },
    { phase: "Founder", label: "Build substance", detail: "Active GitHub org, original commits, live product. Builder persona is real.", source: "github.com", tone: "good" },
    { phase: "Finalize", label: "Score & band", detail: "All axes strong, no caps, +5 dox bonus. Lands firmly in PASS.", tone: "good" }
  ]
};
var nova = {
  handle: "@nova_capital",
  display_name: "Nova Capital",
  avatar: "N",
  bio: "Early-stage crypto fund. Backed 40+ winners. Trusted by the best founders in the space. DURB to pitch.",
  followers: "47.1K",
  joined: "Sep 2023",
  identity: "Probable",
  identity_note: "Named managing partner with a thin but real footprint. Probable \u2192 +3 disclosure bonus.",
  roles: ["INVESTOR" /* INVESTOR */],
  headline: "A 'trusted by the best' fund whose marquee endorsements are unconfirmed, and one the named founder publicly denies.",
  build: (a) => {
    a.addTestimonial({ claimed_endorser_handle: "@balajis", claimed_relationship: "portfolio", public_acknowledgment: "none", follows_subject: false, appears_at: "novacap.io/founders" });
    a.addTestimonial({ claimed_endorser_handle: "@punk6529", claimed_relationship: "portfolio", public_acknowledgment: "none", follows_subject: false, appears_at: "novacap.io/founders" });
    a.addTestimonial({ claimed_endorser_handle: "@kaiynne", claimed_relationship: "portfolio", public_acknowledgment: "none", follows_subject: false, appears_at: "novacap.io/founders" });
    a.addTestimonial({ claimed_endorser_handle: "@DefiDad", claimed_relationship: "advisor_to_subject", fud_present: true, sentiment: "negative", appears_at: "novacap.io/founders", notes: "Publicly stated he has 'never spoken to nova capital' and asked to be removed.", evidence_url: "https://x.com/DefiDad/status/contradicts-nova" });
    a.addFinding({ finding_type: "DeceptionFinding", claim: "Listed @DefiDad as an advisor; he publicly denies any relationship and asked to be removed.", source_url: "https://x.com/DefiDad/status/contradicts-nova", source_date: "2025-02-11", verification_status: "Reported", independent_source_count: 1, polarity: -1 });
    a.addAssociate({ associate_handle: "@cypher_eth", relation: "co-investor", in_cabal_kb: false });
    a.addAssociate({ associate_handle: "@vexnode", relation: "syndicate", in_cabal_kb: true });
  },
  axes: [
    { axis: "I1_identity_legitimacy", score: 9, rationale: "Named partner exists but the fund has no registry record and a 2023 account age against a '40+ winners' claim." },
    { axis: "I2_portfolio_quality", score: 8, rationale: "Most claimed portfolio entries absent from Pitchbook, Crunchbase, and AngelList." },
    { axis: "I3_fund_scale_tier", score: 6, rationale: "No disclosed fund size or raise; behaves as an angel syndicate at most." },
    { axis: "I4_testimonial_corroboration", score: 0, rationale: "3 unconfirmed marquee names plus 1 contradicted. The network is manufactured." },
    { axis: "I5_reputation_fud", score: 11, rationale: "Emerging founder complaints about misrepresented relationships." }
  ],
  trace: [
    { phase: "P0 \xB7 Intake", label: "Resolve handle", detail: "@nova_capital \u2192 canonical key. Account created Sep 2023 vs. '40+ winners' claim. Flag the mismatch.", tone: "warn" },
    { phase: "P0 \xB7 Routing", label: "Classify roles", detail: "Fund / investor signals. Single track: INVESTOR.", tone: "neutral" },
    { phase: "P1 \xB7 Identity", label: "Identity check", detail: "Named partner, thin footprint. Probable \u2192 +3 bonus. Not gated.", tone: "neutral" },
    { phase: "Investor", label: "Portfolio reality", detail: "Claimed 40+ winners. Cross-referencing Pitchbook / Crunchbase / AngelList\u2026 most entries absent.", source: "pitchbook", tone: "warn" },
    { phase: "Investor", label: "Corroborate endorsements", detail: "4 marquee testimonials on novacap.io/founders. Locating each endorser's account\u2026", tone: "neutral" },
    { phase: "Investor", label: "Contradiction found", detail: "@DefiDad publicly denies any relationship and asked to be removed. Contradicted testimonial cap fires (15) + deception flag.", source: "x.com/DefiDad", tone: "bad" },
    { phase: "Finalize", label: "Score & band", detail: "Strong scores elsewhere cannot dilute a contradicted endorsement. Capped at 15.", tone: "bad" }
  ]
};
var delta = {
  handle: "@deltagrowth",
  display_name: "Delta Growth",
  avatar: "\u0394",
  bio: "Full-service Web3 growth. KOL management \xB7 market making \xB7 trending \xB7 raids. 200+ launches. Guaranteed engagement.",
  followers: "31.4K",
  joined: "Jan 2022",
  identity: "Confirmed",
  identity_note: "Registered entity with a named team. Identity is not the problem here.",
  roles: ["AGENCY" /* AGENCY */],
  headline: "A registered, well-branded agency whose core product is manufactured engagement. Service integrity caps it to AVOID.",
  build: (a) => {
    a.addClientEngagement({ client_name: "Pulsechain memecoins (12)", service_type: "market_making", manipulation_service_flag: true, notes: "Wash-trading packages sold as 'volume' tiers.", evidence_url: "https://x.com/zachxbt/delta-volume" });
    a.addClientEngagement({ client_name: "Various", service_type: "raids", manipulation_service_flag: true, notes: "Coordinated bot raids + fake engagement marketed openly.", client_outcome: "SilentShutdown" /* SILENT_SHUTDOWN */ });
    a.addClientEngagement({ client_name: "ZenithDAO", service_type: "market_making", manipulation_service_flag: true, notes: "Sold 'volume' for ZenithDAO in the weeks before its LP was drained. This is the same project @0xlumen advised.", evidence_url: "https://x.com/zachxbt/delta-volume" });
    a.addFinding({ finding_type: "InvestigatorCallout", claim: "Sells wash trading and bot engagement as productized 'volume' and 'trending' tiers.", source_url: "https://x.com/zachxbt/delta-volume", source_date: "2024-12-03", verification_status: "Verified", independent_source_count: 2, source_author: "@zachxbt", polarity: -1 });
    a.addAssociate({ associate_handle: "@vexnode", relation: "repeat-client", in_cabal_kb: true });
  },
  axes: [
    { axis: "AG1_identity_legitimacy", score: 11, rationale: "Registered entity, named team, real footprint. Treated as a contractor." },
    { axis: "AG2_client_outcomes", score: 9, rationale: "Client roster heavy with failed launches and silent shutdowns." },
    { axis: "AG3_service_integrity", score: 3, rationale: "Wash trading, bot raids and fake engagement sold as productized tiers." },
    { axis: "AG4_reputation_fud", score: 12, rationale: "Investigator callouts and sustained community FUD on the agency itself." }
  ],
  trace: [
    { phase: "P0 \xB7 Intake", label: "Resolve handle", detail: "@deltagrowth \u2192 canonical key. Treated as a contractor, not a principal.", tone: "neutral" },
    { phase: "P0 \xB7 Routing", label: "Classify roles", detail: "Agency / growth / market-making signals. Single track: AGENCY.", tone: "neutral" },
    { phase: "Agency", label: "Service integrity", detail: "Site openly sells 'volume' and 'trending' tiers. Parsing for manipulation services\u2026", tone: "warn" },
    { phase: "Agency", label: "Manipulation confirmed", detail: "Wash trading + bot raids productized. Investigator-verified (@zachxbt, 2 sources). Cap fires (10).", source: "x.com/zachxbt", tone: "bad" },
    { phase: "Finalize", label: "Score & band", detail: "Manipulation-as-a-service is a hard cap at 10. A clean brand cannot lift it. AVOID.", tone: "bad" }
  ]
};
var SUBJECTS = [lumen, satoshi, nova, delta];
function findSubject(handle) {
  const norm2 = handle.trim().toLowerCase().replace(/^@/, "").replace(/.*\/(?=[^/]+$)/, "");
  return SUBJECTS.find((s) => s.handle.toLowerCase().replace("@", "") === norm2);
}

// src/data/evidence.ts
function canonicalBasicFactComparisonValue(predicate, value) {
  const normalized4 = value.trim().toLowerCase();
  return predicate.trim().toLowerCase() === "official_token" ? normalized4.replace(/^\$+\s*/, "") : normalized4;
}
function emptyEvidence(handle) {
  const u = handle.replace(/^@/, "");
  return {
    profile: {
      handle: handle.startsWith("@") ? handle : "@" + u,
      display_name: u,
      avatar: u.slice(0, 1).toUpperCase(),
      bio: "",
      followers: "N/A",
      joined: "N/A",
      identity_confidence: "Unverified",
      identity_note: "No identity resolution available.",
      profile_collection_state: "unavailable"
    },
    roles: [],
    ventures: [],
    testimonials: [],
    advised: [],
    wallets: [],
    promotions: [],
    clientEngagements: [],
    associates: [],
    findings: [],
    axes: [],
    webTeam: [],
    headline: "",
    recentActivity: [],
    notableFollowers: [],
    contradictions: [],
    sourceArtifacts: [],
    portfolioLeads: [],
    basicFacts: [],
    basicFactLeads: [],
    basicFactQuestionLedger: []
  };
}

// server/agent.ts
import { createHash } from "node:crypto";

// server/cost.ts
import { AsyncLocalStorage } from "node:async_hooks";
var PRICE = {
  grokIn: 0.2 / 1e6,
  grokOut: 0.5 / 1e6,
  grokSource: 25 / 1e3,
  claudeIn: 3 / 1e6,
  claudeOut: 15 / 1e6,
  claudeWebSearch: 10 / 1e3,
  twitterapiCall: 2e-4,
  pdlMatch: 0.1,
  heliusCall: 1e-4
};
var EST_SOURCES_PER_SEARCH = 5;
var createState = () => ({
  ledger: /* @__PURE__ */ new Map(),
  grok: { in: 0, out: 0, calls: 0, sources: 0 },
  claude: { in: 0, out: 0, calls: 0 }
});
var auditCostState = new AsyncLocalStorage();
var fallbackState = createState();
var currentState = () => auditCostState.getStore() ?? fallbackState;
function withCostLedger(work) {
  return auditCostState.run(createState(), work);
}
var statusCounts = (status) => ({
  succeeded: status === "succeeded" ? 1 : 0,
  partial: status === "partial" ? 1 : 0,
  failed: status === "failed" ? 1 : 0,
  cached: status === "cached" ? 1 : 0
});
var aggregateStatus = (line) => {
  if (line.succeeded === line.calls) return "succeeded";
  if (line.failed === line.calls) return "failed";
  if (line.cached === line.calls) return "cached";
  return "partial";
};
function mergeMeta(current, next) {
  const clean4 = next?.trim();
  if (!clean4 || current?.includes(clean4)) return current;
  return [current, clean4].filter(Boolean).join(" \xB7 ").slice(0, 500);
}
function recordCall(provider, op, usd = 0, meta, status = "succeeded") {
  const { ledger } = currentState();
  const key = `${provider}|${op}`;
  const cur = ledger.get(key);
  if (cur) {
    cur.calls += 1;
    cur.succeeded += status === "succeeded" ? 1 : 0;
    cur.partial += status === "partial" ? 1 : 0;
    cur.failed += status === "failed" ? 1 : 0;
    cur.cached += status === "cached" ? 1 : 0;
    cur.status = aggregateStatus(cur);
    cur.usd += usd;
    cur.meta = mergeMeta(cur.meta, meta);
  } else {
    const counts = statusCounts(status);
    ledger.set(key, { provider, op, calls: 1, ...counts, status, usd, ...meta ? { meta } : {} });
  }
}
function recordTwitterapi(op, status = "succeeded", meta) {
  recordCall("twitterapi", op, PRICE.twitterapiCall, meta, status);
}
function addGrokUsage(u, toolCalls, op = "live-search", status = "succeeded", outcomeMeta) {
  const { grok } = currentState();
  const tin = u?.input_tokens ?? 0;
  const tout = u?.output_tokens ?? 0;
  const sources = typeof u?.num_sources_used === "number" ? u.num_sources_used : (toolCalls ?? 0) * EST_SOURCES_PER_SEARCH;
  grok.calls += 1;
  grok.in += tin;
  grok.out += tout;
  grok.sources += sources;
  recordCall(
    "grok",
    op,
    tin * PRICE.grokIn + tout * PRICE.grokOut + sources * PRICE.grokSource,
    [`${tin + tout} tok \xB7 ~${sources} sources`, outcomeMeta].filter(Boolean).join(" \xB7 "),
    status
  );
}
function addClaudeUsage(u, op = "analysis", status = "succeeded", outcomeMeta) {
  const { claude } = currentState();
  const tin = u?.input_tokens ?? 0;
  const tout = u?.output_tokens ?? 0;
  const webSearches = u?.server_tool_use?.web_search_requests ?? 0;
  claude.calls += 1;
  claude.in += tin;
  claude.out += tout;
  recordCall(
    "claude",
    op,
    tin * PRICE.claudeIn + tout * PRICE.claudeOut + webSearches * PRICE.claudeWebSearch,
    [`${tin + tout} tok`, webSearches ? `${webSearches} web searches` : "", outcomeMeta].filter(Boolean).join(" \xB7 "),
    status
  );
}
function recordPdlMatch(matched, status = "succeeded", meta) {
  recordCall(
    "peopledatalabs",
    "person/enrich",
    matched && status !== "failed" ? PRICE.pdlMatch : 0,
    meta ?? (status === "succeeded" ? matched ? "per-match est" : "no match (free)" : void 0),
    status
  );
}
function recordHelius(op, status = "succeeded", meta) {
  recordCall("helius", op, PRICE.heliusCall, meta, status);
}
var round4 = (n) => Math.round(n * 1e4) / 1e4;
function getCost() {
  const { ledger, grok, claude } = currentState();
  const lines = [...ledger.values()].map((l) => ({ ...l, usd: round4(l.usd) })).sort((a, b) => b.usd - a.usd || b.calls - a.calls);
  const grokUsd = lines.filter((l) => l.provider === "grok").reduce((a, l) => a + l.usd, 0);
  const claudeUsd = lines.filter((l) => l.provider === "claude").reduce((a, l) => a + l.usd, 0);
  const total = lines.reduce((a, l) => a + l.usd, 0);
  const round2 = (n) => Math.round(n * 100) / 100;
  return {
    schemaVersion: 1,
    usd: round2(total),
    grokUsd: round2(grokUsd),
    claudeUsd: round2(claudeUsd),
    grokCalls: grok.calls,
    claudeCalls: claude.calls,
    sources: grok.sources,
    estimated: true,
    calls: lines
  };
}

// src/lib/fundScaleEvidence.ts
var SHA256_HEX = /^[a-f0-9]{64}$/i;
var CLAIM_ID = /^[A-Za-z0-9:_-]{8,180}$/;
var HANDLE = /^[A-Za-z0-9_]{2,30}$/;
var DAY_MS = 24 * 60 * 60 * 1e3;
var CLOCK_SKEW_MS = 5 * 60 * 1e3;
var AUM_MAX_AGE_MS = 731 * DAY_MS;
var AUM_CORROBORATION_WINDOW_MS = 90 * DAY_MS;
var SHARED_PUBLICATION_HOSTS = /* @__PURE__ */ new Set([
  "amazonaws.com",
  "beacons.ai",
  "bio.link",
  "bio.site",
  "bit.ly",
  "blogspot.com",
  "blob.core.windows.net",
  "carrd.co",
  "discord.com",
  "discord.gg",
  "facebook.com",
  "github.com",
  "githubusercontent.com",
  "github.io",
  "gitlab.com",
  "gitbook.io",
  "hackmd.io",
  "instagram.com",
  "ipfs.io",
  "linktr.ee",
  "linkedin.com",
  "medium.com",
  "mirror.xyz",
  "arweave.net",
  "cloudflare-ipfs.com",
  "dweb.link",
  "netlify.app",
  "notion.site",
  "notion.so",
  "pages.dev",
  "paragraph.xyz",
  "pinata.cloud",
  "raw.githubusercontent.com",
  "docs.google.com",
  "drive.google.com",
  "dropbox.com",
  "box.com",
  "firebaseapp.com",
  "framer.app",
  "framer.website",
  "railway.app",
  "render.com",
  "sites.google.com",
  "storage.googleapis.com",
  "substack.com",
  "t.co",
  "t.me",
  "telegram.me",
  "threads.net",
  "tiktok.com",
  "tinyurl.com",
  "twitch.tv",
  "twitter.com",
  "vercel.app",
  "webflow.io",
  "wixsite.com",
  "wordpress.com",
  "x.com",
  "youtu.be",
  "youtube.com"
]);
var INDEPENDENT_PRESS_HOSTS = [
  "reuters.com",
  "bloomberg.com",
  "ft.com",
  "wsj.com",
  "techcrunch.com",
  "fortune.com",
  "coindesk.com",
  "theblock.co",
  "decrypt.co",
  "blockworks.co",
  "venturebeat.com"
];
var PUBLIC_SUFFIX_ONLY = /* @__PURE__ */ new Set([
  "com",
  "org",
  "net",
  "edu",
  "gov",
  "io",
  "ai",
  "app",
  "co",
  "xyz",
  "co.uk",
  "org.uk",
  "gov.uk",
  "ac.uk",
  "com.au",
  "net.au",
  "org.au",
  "co.nz",
  "com.br",
  "co.jp"
]);
var SECOND_LEVEL_PUBLIC_SUFFIX_LABELS = /* @__PURE__ */ new Set([
  "ac",
  "asn",
  "co",
  "com",
  "edu",
  "firm",
  "gen",
  "go",
  "gov",
  "id",
  "ind",
  "ltd",
  "me",
  "mil",
  "net",
  "ne",
  "nom",
  "or",
  "org",
  "plc",
  "police",
  "res",
  "sch",
  "school"
]);
var SENSITIVE_URL_PARAM = /^(?:(?:x[-_]?(?:amz|goog)|x[-_](?:oss|cos))[-_].+|x[-_]ms[-_](?:signature|token|credential)|access[_-]?token|api[_-]?key|key|token|signature|sig|auth|credential|credentials|security[_-]?token|session[_-]?token|awsaccesskeyid|googleaccessid|key[_-]?pair[_-]?id|policy|cf[_-]?access[_-]?token)$/i;
var asRecord = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : null;
var comparable = (value) => typeof value === "string" ? value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "") : "";
var namesExactlyMatch = (left, right) => {
  const a = comparable(left);
  const b = comparable(right);
  return Boolean(a && b && a === b);
};
var canonicalHandle = (value) => typeof value === "string" ? value.trim().replace(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\//i, "").replace(/^@/, "").toLowerCase() : "";
var normalizedWords = (value) => typeof value === "string" ? value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9@_]+/g, " ").trim() : "";
var providerEntityNamesMatch = (left, right) => {
  const a = normalizedWords(left);
  const b = normalizedWords(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  return shorter.length >= 5 && (longer.startsWith(`${shorter} `) || longer.endsWith(` ${shorter}`));
};
var regexEscape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
var AFFILIATION_ROLE = "(?:founding |general |managing |research )?(?:partner|principal|investor|researcher|research|engineer|developer|employee|advisor|adviser|cto|chief technology officer|team member|team|lead|director|gp)|(?:co founder|cofounder|founder|ceo|chief executive officer|cio|chief investment officer|portfolio manager|managing director)";
var profileBioHasCurrentAffiliation = (profile, value) => {
  const bio = normalizedWords(profile.bio);
  if (!bio) return false;
  const entity = normalizedWords(value.investorEntityName ?? value.fundName);
  const handle = canonicalHandle(value.investorEntityHandle);
  const aliases = [entity, handle].filter((alias, index, all) => Boolean(alias) && all.indexOf(alias) === index);
  const role = `(?:${AFFILIATION_ROLE})`;
  const affiliationLink = "(?:(?:at|with)\\s+|@\\s*)";
  return aliases.some((alias) => {
    const escaped = normalizedWords(alias).split(/\s+/).filter(Boolean).map(regexEscape).join("[^a-z0-9@_]+");
    if (!escaped) return false;
    const patterns = [
      new RegExp(`(?:${role})\\s+${affiliationLink}(?:the\\s+)?@?${escaped}(?=$|[^a-z0-9_])`, "gi"),
      new RegExp(`@?${escaped}[^a-z0-9_]+(?:${role})\\b`, "gi"),
      new RegExp(`\\b(?:work(?:ing|s)?|build(?:ing|s)?|research(?:ing|es)?)\\s+${affiliationLink}(?:the\\s+)?@?${escaped}(?=$|[^a-z0-9_])`, "gi")
    ];
    return patterns.some((pattern) => [...bio.matchAll(pattern)].some((match) => {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      const before = bio.slice(Math.max(0, start - 70), start);
      const after = bio.slice(end, Math.min(bio.length, end + 55));
      const endedMarkers = [...before.matchAll(/\b(?:former|formerly|previously|ex|no longer|left|departed|retired)\b/gi)];
      const currentMarkers = [...before.matchAll(/\b(?:now|currently)\b/gi)];
      const lastEnded = endedMarkers.at(-1)?.index ?? -1;
      const lastCurrent = currentMarkers.at(-1)?.index ?? -1;
      if (lastEnded >= 0 && lastCurrent < lastEnded) return false;
      const matchedContext = `${before.slice(-40)} ${match[0]}`;
      if (new RegExp(`\\b(?:not|never)\\s+(?:currently\\s+)?(?:an?\\s+)?(?:${AFFILIATION_ROLE})\\b`, "i").test(matchedContext) || /\b(?:no\s+(?:current\s+)?affiliation|not\s+affiliated|never\s+(?:worked|working))\b/i.test(matchedContext) || /\b(?:not|never)(?:\s+an?)?\s*$/i.test(before) && new RegExp(`(?:${role})\\b`, "i").test(match[0])) return false;
      return !/^.{0,45}\b(?:former|formerly|no longer|left|departed|retired|until|through)\b/i.test(after);
    }));
  });
};
var profileBioHasCurrentHandleAffiliation = (profile, value) => {
  const bio = normalizedWords(profile.bio);
  const handle = canonicalHandle(value);
  if (!bio || !HANDLE.test(handle)) return false;
  const role = `(?:${AFFILIATION_ROLE})`;
  const pattern = new RegExp(`@${regexEscape(handle)}(?=$|[^a-z0-9_])`, "gi");
  for (const match of bio.matchAll(pattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const before = bio.slice(Math.max(0, start - 100), start);
    const after = bio.slice(end, Math.min(bio.length, end + 70));
    const endedMarkers = [...before.matchAll(/\b(?:former|formerly|previously|ex|no longer|left|departed|retired)\b/gi)];
    const currentMarkers = [...before.matchAll(/\b(?:now|currently)\b/gi)];
    const lastEnded = endedMarkers.at(-1)?.index ?? -1;
    const lastCurrent = currentMarkers.at(-1)?.index ?? -1;
    if (lastEnded >= 0 && lastCurrent < lastEnded) continue;
    if (/^[^.;|]{0,55}\b(?:no longer|left|departed|retired|until|through)\b/i.test(after)) continue;
    if (new RegExp(`\\b(?:not|never)\\s+(?:currently\\s+)?(?:an?\\s+)?(?:${AFFILIATION_ROLE})\\b[^.;|]{0,35}$`, "i").test(before) || /\b(?:no\s+(?:current\s+)?affiliation|not\s+affiliated|never\s+(?:worked|working))\b[^.;|]{0,35}$/i.test(before)) continue;
    if (/\b(?:not|never)(?:\s+an?)?\s*$/i.test(before) && new RegExp(`^\\s*(?:${role})\\b`, "i").test(after)) continue;
    if (new RegExp(`${role}\\s*(?:(?:at|with)\\s*)?$`, "i").test(before)) return true;
    if (/\b(?:work(?:ing|s)?|build(?:ing|s)?|research(?:ing|es)?)\s*(?:(?:at|with)\s*)?$/i.test(before)) return true;
    if (new RegExp(`^\\s*(?:${role})\\b`, "i").test(after)) return true;
  }
  return false;
};
var cleanHost = (value) => value.replace(/^www\./i, "").toLowerCase();
var isSharedPublicationHost = (host) => {
  const clean4 = cleanHost(host);
  return [...SHARED_PUBLICATION_HOSTS].some((candidate) => clean4 === candidate || clean4.endsWith(`.${candidate}`));
};
var isPublicHostname = (value) => {
  const host = cleanHost(value).replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host || host.includes(":") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".test") || host.endsWith(".invalid")) return false;
  const labels = host.split(".");
  return labels.length >= 2 && labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)) && /^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/i.test(labels.at(-1) ?? "");
};
var isCredibleOfficialDomain = (value) => {
  const host = cleanHost(value).replace(/\.$/, "");
  if (!isPublicHostname(host) || PUBLIC_SUFFIX_ONLY.has(host) || isSharedPublicationHost(host) || INDEPENDENT_PRESS_HOSTS.some((candidate) => host === candidate || host.endsWith(`.${candidate}`)) || ["sec.gov", "fca.org.uk", "gov.uk", "companieshouse.gov.uk", "asic.gov.au", "sedarplus.ca"].some((candidate) => host === candidate || host.endsWith(`.${candidate}`))) return false;
  const labels = host.split(".");
  return !(labels.length === 2 && labels[1].length === 2 && SECOND_LEVEL_PUBLIC_SUFFIX_LABELS.has(labels[0]));
};
var listedHost = (host, list) => list.some((candidate) => hostMatches(host, candidate));
var boundedWebUrl = (value) => {
  if (typeof value !== "string" || value.length > 2e3) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname || !isPublicHostname(url.hostname) || [...url.searchParams.keys()].some((key) => SENSITIVE_URL_PARAM.test(key))) return null;
    return url;
  } catch {
    return null;
  }
};
var profileWebsiteHost = (value) => {
  return canonicalOfficialWebsite(value)?.domain ?? null;
};
var canonicalPublicProfileWebsite = (value) => {
  if (typeof value !== "string" || !value.trim() || value.length > 2e3) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    const host = cleanHost(url.hostname).replace(/\.$/, "");
    if (url.protocol !== "https:" && url.protocol !== "http:" || url.username || url.password || url.port || !isPublicHostname(host) || [...url.searchParams.keys()].some((key) => SENSITIVE_URL_PARAM.test(key))) return null;
    const pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
    return `https://${host}${pathname === "/" ? "/" : pathname}`;
  } catch {
    return null;
  }
};
var canonicalOfficialWebsite = (value) => {
  const canonical2 = canonicalPublicProfileWebsite(value);
  if (!canonical2) return null;
  try {
    const url = new URL(canonical2);
    const domain = cleanHost(url.hostname).replace(/\.$/, "");
    if (!isCredibleOfficialDomain(domain)) return null;
    return {
      domain,
      canonicalUrl: canonical2
    };
  } catch {
    return null;
  }
};
var sourceMatchesOfficialWebsiteScope = (sourceValue, profileWebsite) => {
  const source2 = sourceValue instanceof URL ? sourceValue : boundedWebUrl(sourceValue);
  const scope = canonicalOfficialWebsite(profileWebsite);
  if (!source2 || !scope || !hostMatches(source2.hostname, scope.domain)) return false;
  const scopeUrl = new URL(scope.canonicalUrl);
  if (scopeUrl.pathname === "/") return true;
  const sourcePath = source2.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
  const scopePath = scopeUrl.pathname.replace(/\/$/, "");
  return cleanHost(source2.hostname) === scope.domain && (sourcePath === scopePath || sourcePath.startsWith(`${scopePath}/`));
};
var validatedPacketProfile = (context, now, artifactCapturedAt) => {
  const profile = asRecord(context.profile);
  const expectedHandle = canonicalHandle(context.subjectHandle);
  const profileCapturedAt = validDate(profile?.profile_captured_at);
  if (!profile || !expectedHandle || canonicalHandle(profile.handle) !== expectedHandle || profile.profile_collection_state !== "resolved" || profile.profile_provider !== "twitterapi" || !profileCapturedAt || profileCapturedAt.getTime() > now.getTime() + CLOCK_SKEW_MS || profileCapturedAt.getTime() > artifactCapturedAt.getTime() + CLOCK_SKEW_MS || artifactCapturedAt.getTime() - profileCapturedAt.getTime() > 7 * DAY_MS) return null;
  return profile;
};
var hostMatches = (host, expected) => {
  const left = cleanHost(host);
  const right = cleanHost(expected);
  return left === right || left.endsWith(`.${right}`);
};
var registrableApprox = (host) => {
  const parts = cleanHost(host).split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const twoLevelSuffixes = /* @__PURE__ */ new Set(["co.uk", "org.uk", "com.au", "com.br", "co.nz", "co.jp"]);
  const tail = parts.slice(-2).join(".");
  return twoLevelSuffixes.has(tail) ? parts.slice(-3).join(".") : tail;
};
var validDate = (value) => {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};
var isAumMetric = (metric) => metric === "regulatory_aum" || metric === "reported_aum";
var isRecordSpecificRegulatoryUrl = (url) => {
  const host = cleanHost(url.hostname);
  const path = url.pathname;
  if (host === "sec.gov" || host.endsWith(".sec.gov")) {
    return /^\/Archives\/edgar\/data\/\d{1,12}\/\d{18}\/[^/]+\.(?:html?|txt|xml|json)$/i.test(path) || /^\/firm\/summary\/\d+\/?$/i.test(path);
  }
  if (host === "fca.org.uk" || host.endsWith(".fca.org.uk")) {
    return /\/(?:firm|individual)\/details\/\d+/i.test(path) || /\/services\/v1\/(?:firm|individual)\//i.test(path);
  }
  if (host === "companieshouse.gov.uk" || host.endsWith(".companieshouse.gov.uk") || host === "find-and-update.company-information.service.gov.uk" || host === "api.company-information.service.gov.uk") {
    return /\/company\/[A-Z0-9]{6,12}(?:\/|$)/i.test(path);
  }
  return false;
};
var hasCurrentAffiliationProof = (value, capturedAt, now, profile) => {
  const subjectName3 = comparable(value.subjectName);
  const handle = typeof value.subjectHandle === "string" ? value.subjectHandle.trim().replace(/^@/, "") : "";
  const source2 = boundedWebUrl(value.attributionSourceUrl);
  const sourceHash = typeof value.attributionSourceContentHash === "string" ? value.attributionSourceContentHash : "";
  const affiliationCapturedAt = validDate(value.attributionCapturedAt);
  if (!subjectName3 || !HANDLE.test(handle) || !source2 || !SHA256_HEX.test(sourceHash) || !affiliationCapturedAt) return false;
  if (affiliationCapturedAt.getTime() > now.getTime() + CLOCK_SKEW_MS || affiliationCapturedAt.getTime() > capturedAt.getTime() + CLOCK_SKEW_MS || capturedAt.getTime() - affiliationCapturedAt.getTime() > 7 * DAY_MS) return false;
  const host = cleanHost(source2.hostname);
  const path = source2.pathname.split("/").filter(Boolean);
  if (value.attributionSourceKind !== "provider_profile") return false;
  const sourceBound = (host === "x.com" || host === "twitter.com") && path.length === 1 && path[0].toLowerCase() === handle.toLowerCase() && !source2.search && !source2.hash;
  if (!sourceBound) return false;
  if (!profile) return true;
  const profileCapturedAt = validDate(profile.profile_captured_at);
  return Boolean(
    profileCapturedAt && Math.abs(profileCapturedAt.getTime() - affiliationCapturedAt.getTime()) <= 1e3 && profileBioHasCurrentAffiliation(profile, value)
  );
};
var hasOfficialInvestorDomainProof = (value, capturedAt, now, profile) => {
  const officialDomain = typeof value.investorEntityDomain === "string" ? cleanHost(value.investorEntityDomain) : "";
  const source2 = boundedWebUrl(value.investorDomainSourceUrl);
  const sourceHash = typeof value.investorDomainSourceContentHash === "string" ? value.investorDomainSourceContentHash : "";
  const domainCapturedAt = validDate(value.investorDomainCapturedAt);
  const fundHandle = canonicalHandle(value.investorEntityHandle);
  const profileName = typeof value.investorDomainProfileName === "string" ? value.investorDomainProfileName.trim() : "";
  const profileWebsite = typeof value.investorDomainProfileWebsite === "string" ? value.investorDomainProfileWebsite.trim() : "";
  const profileWebsiteUrl = boundedWebUrl(profileWebsite);
  if (value.investorDomainSourceKind !== "provider_profile" || !isCredibleOfficialDomain(officialDomain) || !source2 || !SHA256_HEX.test(sourceHash) || !domainCapturedAt || !fundHandle || !profileName || !profileWebsite || !profileWebsiteUrl || profileWebsiteUrl.search || profileWebsiteUrl.hash || !providerEntityNamesMatch(profileName, value.investorEntityName) || profileWebsiteHost(profileWebsite) !== officialDomain || !sourceMatchesOfficialWebsiteScope(value.sourceUrl, profileWebsite) || !profile || !profileBioHasCurrentHandleAffiliation(profile, fundHandle)) return false;
  if (domainCapturedAt.getTime() > now.getTime() + CLOCK_SKEW_MS || domainCapturedAt.getTime() > capturedAt.getTime() + CLOCK_SKEW_MS || capturedAt.getTime() - domainCapturedAt.getTime() > 7 * DAY_MS) return false;
  const host = cleanHost(source2.hostname);
  const path = source2.pathname.split("/").filter(Boolean);
  return (host === "x.com" || host === "twitter.com") && path.length === 1 && path[0].toLowerCase() === fundHandle && !source2.search && !source2.hash;
};
var structurallyStrictFundScaleArtifact = (value, now, context) => {
  if (value.kind !== "fund_scale" || value.provider !== "fund-scale-web" || value.match !== "fund_scale_confirmed") return false;
  const sourceUrl = boundedWebUrl(value.sourceUrl);
  const capturedAt = validDate(value.capturedAt);
  const fundName = comparable(value.fundName);
  const investorName = comparable(value.investorEntityName);
  const amount = value.fundSizeUsd;
  const attribution = value.attribution;
  const sourceClass3 = value.sourceClass;
  const metric = value.fundScaleMetric;
  const qualifier = value.fundAmountQualifier;
  const basis = value.fundScaleBasis;
  const temporalState = value.fundScaleTemporalState;
  const claimId = typeof value.fundScaleClaimId === "string" ? value.fundScaleClaimId : "";
  if (!SHA256_HEX.test(typeof value.contentHash === "string" ? value.contentHash : "") || !SHA256_HEX.test(typeof value.sourceContentHash === "string" ? value.sourceContentHash : "") || !sourceUrl || !capturedAt || capturedAt.getTime() > now.getTime() + CLOCK_SKEW_MS || typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 1e5 || amount > 1e13 || !fundName || !investorName || !namesExactlyMatch(value.fundName, value.investorEntityName) || attribution !== "direct_subject" && attribution !== "affiliated_fund" || !["first_party_subject", "first_party_investor", "public_primary", "independent_press"].includes(String(sourceClass3)) || !["regulatory_aum", "reported_aum", "fund_vehicle", "first_close", "final_close"].includes(String(metric)) || !["exact", "at_least", "approximate"].includes(String(qualifier)) || !["regulatory", "manager_reported", "press_corroborated"].includes(String(basis)) || !CLAIM_ID.test(claimId)) return false;
  const expectedSubjectHandle = context.subjectHandle;
  if (expectedSubjectHandle) {
    const observedHandle = canonicalHandle(value.subjectHandle);
    if (!observedHandle || observedHandle !== canonicalHandle(expectedSubjectHandle)) return false;
  }
  const profile = expectedSubjectHandle ? validatedPacketProfile(context, now, capturedAt) : null;
  if (expectedSubjectHandle && !profile) return false;
  if (attribution === "direct_subject") {
    if (!namesExactlyMatch(value.subjectName, value.fundName)) return false;
    if (profile && ![profile.resolved_name, profile.display_name].some((name) => namesExactlyMatch(name, value.fundName))) return false;
  } else if (!hasCurrentAffiliationProof(value, capturedAt, now, profile)) return false;
  if (sourceClass3 === "first_party_subject" || sourceClass3 === "first_party_investor") {
    const officialDomain = typeof value.investorEntityDomain === "string" ? cleanHost(value.investorEntityDomain) : "";
    if (!isCredibleOfficialDomain(officialDomain) || !hostMatches(sourceUrl.hostname, officialDomain) || basis !== "manager_reported" || metric === "regulatory_aum" || sourceClass3 === "first_party_subject" !== (attribution === "direct_subject")) return false;
    if (sourceClass3 === "first_party_investor") {
      if (!hasOfficialInvestorDomainProof(value, capturedAt, now, profile)) return false;
    } else if (profile && (profileWebsiteHost(profile.website) !== officialDomain || !sourceMatchesOfficialWebsiteScope(sourceUrl, profile.website))) return false;
  } else if (sourceClass3 === "public_primary") {
    if (basis !== "regulatory" || metric !== "regulatory_aum" || !isRecordSpecificRegulatoryUrl(sourceUrl)) return false;
  } else if (basis !== "press_corroborated" || metric === "regulatory_aum" || !listedHost(sourceUrl.hostname, INDEPENDENT_PRESS_HOSTS) || typeof value.fundScaleSourceCount !== "number" || !Number.isInteger(value.fundScaleSourceCount) || value.fundScaleSourceCount < 2) return false;
  if (isAumMetric(metric)) {
    const asOf = validDate(value.fundScaleAsOf);
    if (temporalState !== "current" || !asOf || asOf.getTime() > capturedAt.getTime() + DAY_MS || capturedAt.getTime() - asOf.getTime() > AUM_MAX_AGE_MS) return false;
  } else {
    if (temporalState !== "fixed_historical") return false;
    if (typeof value.fundVehicle !== "string" || !comparable(value.fundVehicle)) return false;
  }
  if (metric === "first_close" && qualifier !== "at_least") return false;
  return true;
};
var compatiblePressClaim = (left, right) => {
  if (left.fundScaleClaimId !== right.fundScaleClaimId || left.fundScaleMetric !== right.fundScaleMetric || left.attribution !== right.attribution || !namesExactlyMatch(left.fundName, right.fundName) || !namesExactlyMatch(left.investorEntityName, right.investorEntityName)) return false;
  const leftAmount = left.fundSizeUsd;
  const rightAmount = right.fundSizeUsd;
  const tolerance = isAumMetric(left.fundScaleMetric) ? 0.1 : 0.01;
  if (Math.abs(leftAmount - rightAmount) / Math.max(leftAmount, rightAmount) > tolerance) return false;
  if (!isAumMetric(left.fundScaleMetric)) return comparable(left.fundVehicle) === comparable(right.fundVehicle);
  const leftAsOf = validDate(left.fundScaleAsOf);
  const rightAsOf = validDate(right.fundScaleAsOf);
  return Boolean(leftAsOf && rightAsOf && Math.abs(leftAsOf.getTime() - rightAsOf.getTime()) <= AUM_CORROBORATION_WINDOW_MS);
};
function isStrictFundScaleArtifact(value, peers = [], context = {}) {
  const now = context.now ?? /* @__PURE__ */ new Date();
  const record2 = asRecord(value);
  if (!record2 || !Number.isFinite(now.getTime()) || !structurallyStrictFundScaleArtifact(record2, now, context)) return false;
  if (record2.sourceClass !== "independent_press") return true;
  if (typeof record2.fundScaleSourceCount !== "number" || record2.fundScaleSourceCount < 2) return false;
  const compatible = [record2, ...peers.map(asRecord).filter((peer) => Boolean(peer))].filter((peer, index, rows) => rows.indexOf(peer) === index).filter((peer) => peer.sourceClass === "independent_press" && structurallyStrictFundScaleArtifact(peer, now, context) && compatiblePressClaim(record2, peer));
  const domains = /* @__PURE__ */ new Set();
  const hashes = /* @__PURE__ */ new Set();
  const prose = /* @__PURE__ */ new Set();
  for (const peer of compatible) {
    const source2 = boundedWebUrl(peer.sourceUrl);
    if (!source2) continue;
    domains.add(registrableApprox(source2.hostname));
    hashes.add(String(peer.sourceContentHash).toLowerCase());
    const excerpt = comparable(peer.excerpt);
    if (excerpt) prose.add(excerpt);
  }
  return domains.size >= 2 && hashes.size >= 2 && prose.size >= 2;
}

// src/lib/investigationRuntime.ts
var DEEP_INVESTIGATION_MAX_DURATION_SECONDS = 600;
var ANALYST_SCORING_TIMEOUT_MS = 18e4;
var ANALYST_REPAIR_TIMEOUT_MS = 9e4;
var ANALYST_FINALIZATION_RESERVE_MS = 9e4;

// server/agent.ts
var ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
var XAI_CHAT_URL = "https://api.x.ai/v1/chat/completions";
var SCHEMA_COMPILATION_ERROR = /compiled grammar is too large|schema is too complex for compilation/i;
var failureMeta = (error, timeoutMs, fallback) => error instanceof Error && error.name === "TimeoutError" ? `timeout_${timeoutMs}ms` : fallback;
function analystAvailable() {
  return Boolean(env("ANTHROPIC_API_KEY") || env("XAI_API_KEY"));
}
async function structured(system, user, tool, maxTokens = 2048, timeoutMs = 6e4) {
  const deadlineAt = Date.now() + Math.max(0, timeoutMs);
  const claude = env("ANTHROPIC_API_KEY") ? await structuredClaude(system, user, tool, maxTokens, timeoutMs) : null;
  if (claude !== null || !env("XAI_API_KEY")) return claude;
  const remainingMs = Math.max(0, deadlineAt - Date.now());
  if (remainingMs < 1) return null;
  return structuredGrok(system, user, tool, maxTokens, remainingMs);
}
async function structuredClaude(system, user, tool, maxTokens, timeoutMs) {
  const key = env("ANTHROPIC_API_KEY");
  if (!key) return null;
  const startedAt = Date.now();
  const requestBody = JSON.stringify({
    model: ANALYST_MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
    tools: [tool],
    tool_choice: { type: "tool", name: tool.name, disable_parallel_tool_use: true }
  });
  const requestMetrics = {
    tool: tool.name,
    requestBytes: Buffer.byteLength(requestBody),
    schemaBytes: Buffer.byteLength(JSON.stringify(tool.input_schema)),
    userBytes: Buffer.byteLength(user),
    timeoutMs
  };
  let res;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: requestBody,
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (e) {
    const failure = failureMeta(e, timeoutMs, "transport_error");
    addClaudeUsage(void 0, tool.name, "failed", failure);
    console.info("[agent-call]", JSON.stringify({
      ...requestMetrics,
      state: "failed",
      failure,
      elapsedMs: Date.now() - startedAt
    }));
    console.error(`[agent] ${tool.name} request failed (${failure})`, e);
    return null;
  }
  const requestId = res.headers.get("request-id") || res.headers.get("x-request-id");
  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
    }
    const failure = res.status === 400 && SCHEMA_COMPILATION_ERROR.test(detail) ? "schema_too_complex" : `http_${res.status}`;
    addClaudeUsage(void 0, tool.name, "failed", failure);
    console.info("[agent-call]", JSON.stringify({
      ...requestMetrics,
      state: "failed",
      failure,
      httpStatus: res.status,
      requestId,
      elapsedMs: Date.now() - startedAt
    }));
    console.error("[agent] anthropic error", res.status, detail);
    return null;
  }
  let data;
  try {
    data = await res.json();
  } catch (e) {
    const failure = failureMeta(e, timeoutMs, "response_json_error");
    addClaudeUsage(void 0, tool.name, "failed", failure);
    console.info("[agent-call]", JSON.stringify({
      ...requestMetrics,
      state: "failed",
      failure,
      httpStatus: res.status,
      requestId,
      elapsedMs: Date.now() - startedAt
    }));
    console.error(`[agent] ${tool.name} response parse failed (${failure})`, e);
    return null;
  }
  const toolBlocks = Array.isArray(data.content) ? data.content.filter((candidate) => candidate.type === "tool_use") : [];
  const matchingBlocks = toolBlocks.filter((candidate) => candidate.name === tool.name && candidate.input != null);
  const block = data.stop_reason === "tool_use" && toolBlocks.length === 1 && matchingBlocks.length === 1 ? matchingBlocks[0] : void 0;
  const partialReason = data.stop_reason !== "tool_use" ? `stop_reason_${data.stop_reason || "missing"}` : matchingBlocks.length === 0 ? "missing_tool_use" : "ambiguous_tool_use";
  addClaudeUsage(
    data.usage,
    tool.name,
    block ? "succeeded" : "partial",
    block ? void 0 : partialReason
  );
  console.info("[agent-call]", JSON.stringify({
    ...requestMetrics,
    state: block ? "succeeded" : "partial",
    httpStatus: res.status,
    requestId,
    stopReason: data.stop_reason ?? null,
    inputTokens: data.usage?.input_tokens ?? null,
    outputTokens: data.usage?.output_tokens ?? null,
    toolUseCount: toolBlocks.length,
    elapsedMs: Date.now() - startedAt,
    ...block ? {} : { failure: partialReason }
  }));
  return block?.input ?? null;
}
async function structuredGrok(system, user, tool, maxTokens, timeoutMs) {
  const key = env("XAI_API_KEY");
  if (!key) return null;
  const startedAt = Date.now();
  const requestBody = JSON.stringify({
    model: env("ARGUS_GROK_ANALYST_MODEL") || env("ARGUS_GROK_MODEL") || "grok-4-fast",
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: `${system}

Return exactly one ${tool.name} object. ${tool.description}` },
      { role: "user", content: user }
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: tool.name,
        strict: true,
        schema: tool.input_schema
      }
    }
  });
  const requestMetrics = {
    provider: "grok",
    tool: tool.name,
    requestBytes: Buffer.byteLength(requestBody),
    schemaBytes: Buffer.byteLength(JSON.stringify(tool.input_schema)),
    userBytes: Buffer.byteLength(user),
    timeoutMs
  };
  let response;
  try {
    response = await fetch(XAI_CHAT_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json"
      },
      body: requestBody,
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    const failure = failureMeta(error, timeoutMs, "transport_error");
    addGrokUsage(void 0, 0, tool.name, "failed", failure);
    console.info("[agent-call]", JSON.stringify({
      ...requestMetrics,
      state: "failed",
      failure,
      elapsedMs: Date.now() - startedAt
    }));
    return null;
  }
  const requestId = response.headers.get("x-request-id") || response.headers.get("request-id");
  if (!response.ok) {
    addGrokUsage(void 0, 0, tool.name, "failed", `http_${response.status}`);
    console.info("[agent-call]", JSON.stringify({
      ...requestMetrics,
      state: "failed",
      failure: `http_${response.status}`,
      httpStatus: response.status,
      requestId,
      elapsedMs: Date.now() - startedAt
    }));
    return null;
  }
  let data;
  try {
    data = await response.json();
  } catch (error) {
    const failure = failureMeta(error, timeoutMs, "response_json_error");
    addGrokUsage(void 0, 0, tool.name, "failed", failure);
    console.info("[agent-call]", JSON.stringify({
      ...requestMetrics,
      state: "failed",
      failure,
      httpStatus: response.status,
      requestId,
      elapsedMs: Date.now() - startedAt
    }));
    return null;
  }
  const content = data.choices?.[0]?.message?.content;
  const parsed = (() => {
    try {
      return typeof content === "string" ? JSON.parse(content) : content;
    } catch {
      return null;
    }
  })();
  const usage = {
    input_tokens: data.usage?.prompt_tokens,
    output_tokens: data.usage?.completion_tokens,
    num_sources_used: data.usage?.num_sources_used
  };
  const valid = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
  addGrokUsage(usage, 0, tool.name, valid ? "succeeded" : "partial", valid ? void 0 : "invalid_structured_output");
  console.info("[agent-call]", JSON.stringify({
    ...requestMetrics,
    state: valid ? "succeeded" : "partial",
    httpStatus: response.status,
    requestId,
    inputTokens: usage.input_tokens ?? null,
    outputTokens: usage.output_tokens ?? null,
    elapsedMs: Date.now() - startedAt,
    ...valid ? {} : { failure: "invalid_structured_output" }
  }));
  return valid ? parsed : null;
}
async function extractClaims(handle, bio, posts) {
  const system = "You are ARGUS intake. From a subject's own bio and recent posts, extract the claims they make about themselves so they can be verified later. Capture CLAIMS ONLY, never judge truth. Roles drawn from: FOUNDER, PROJECT, KOL, INVESTOR, ADVISOR, AGENCY, MEMBER. Classify the ACCOUNT TYPE precisely: PROJECT = the account IS an organization: a token, protocol, product, company, or DAO's own brand/official handle (usually named after the project, speaks as 'we/our', ships and promotes its OWN single token/product). FOUNDER = an individual PERSON who founded or leads a project (a personal account, speaks as 'I'). KOL = an influencer/caller whose activity is promoting OTHER people's tokens across MANY different projects (calls, alpha, gems, paid shills for others), NOT their own. INVESTOR = PROFESSIONAL capital allocation ONLY: an actual fund/VC/syndicate (or its official brand account), a GP/partner/principal at one, or an angel with NAMED, verifiable investments (led or joined specific rounds). Buying/trading tokens, 'investing in gems', or calling oneself an investor with no documented deals is NOT INVESTOR. A caller who trades is a KOL, nothing more. Decisive rules: a brand account promoting its own token is PROJECT (never KOL); an investment firm's brand account is INVESTOR, NOT PROJECT (PROJECT is for accounts shipping a product/token, not allocating capital); an individual builder is FOUNDER; only tag KOL when they shill multiple external tokens they did not build. A subject can hold several roles, but do not tag KOL merely for hype words or for promoting the project's own token, and do not tag INVESTOR merely for trading talk. Ventures = companies/projects they say they founded or led. Testimonials = named people/accounts they cite as backers or endorsers. Advised = projects they claim to advise. Promotions = tokens/tickers they shill; for a prolific caller capture EVERY distinct token they promoted (each cashtag / chart-link post is a call), not just a few, listing each ticker once with its contract address and chain when a chart link or CA is present. Use the @handle form for accounts. Omit anything not actually claimed. Never use em dashes.";
  const user = `Subject: ${handle}
Bio: ${bio || "(none)"}

Posts (a claim-targeted corpus: recent originals + keyword-searched history, each stamped [Month Year \xB7 views]; dates let you fill venture periods, engagement shows which claims the subject pushed):
${posts.slice(0, 70).map((p, i) => `${i + 1}. ${p}`).join("\n") || "(none)"}`;
  const tool = {
    name: "record_claims",
    description: "Record the subject's self-claimed roles, ventures, endorsers, advisory seats, and promotions.",
    input_schema: {
      type: "object",
      properties: {
        roles: { type: "array", items: { type: "string" } },
        ventures: {
          type: "array",
          items: {
            type: "object",
            properties: { project_name: { type: "string" }, role: { type: "string" }, period: { type: "string" }, claimed_outcome: { type: "string" } },
            required: ["project_name"]
          }
        },
        testimonials: {
          type: "array",
          items: {
            type: "object",
            properties: { claimed_endorser_handle: { type: "string" }, claimed_relationship: { type: "string" } },
            required: ["claimed_endorser_handle"]
          }
        },
        advised: {
          type: "array",
          items: {
            type: "object",
            properties: { project_name: { type: "string" }, project_handle: { type: "string" }, claimed_role: { type: "string" } },
            required: ["project_name"]
          }
        },
        promotions: {
          type: "array",
          items: {
            type: "object",
            properties: { ticker: { type: "string" }, contract_address: { type: "string" }, chain: { type: "string" } },
            required: ["ticker"]
          }
        }
      },
      required: ["roles", "ventures", "testimonials", "advised", "promotions"]
    }
  };
  return structured(system, user, tool, 4096);
}
var lvl = (s) => {
  const v = (s ?? "").toLowerCase();
  return v === "high" ? "high" : v === "low" ? "low" : "medium";
};
async function scanContradictions(handle, evidenceJson, options = {}) {
  const system = "You are ARGUS contradiction analysis. From everything collected about a subject, find INTERNAL CONTRADICTIONS: where the subject's own stated claims conflict with each other or with the collected evidence. Examples: claims a team of N but only one builder is found; claims an audit but no auditor or verification exists; claims a named backer who never acknowledges them; a stated launch/founding date that conflicts with the account age, domain age, or on-chain history; claims 'doxxed' but no real identity resolves; claims locked liquidity that on-chain shows unlocked; a partnership the partner never confirmed; a venture in the bio that discovery found no evidence for. Be STRICT and grounded: report ONLY genuine contradictions, each with the EXACT claim and the EXACT conflicting fact from the evidence. A missing or unverifiable data point is a GAP, not a contradiction; never report gaps, and never invent. If there are none, return an empty list. Never use em dashes. SCOPE RULES: these are NOT contradictions: (1) ARGUS's OWN analysis metadata (fields like identity_confidence, identity_note, verdicts, evidence notes such as 'single-source lead, unverified') disagreeing with other ARGUS fields. Only the SUBJECT's outward claims vs external facts count; a low-confidence evidence note is a gap, not a conflict. (2) Normal vertical integration: a project's token running on its own chain, its dApp on its own platform, or its products naming each other is how ecosystems work, not circularity. (3) Marketing self-description ('#1', 'leading') vs modest traction is puffery to note in scoring, not a contradiction, unless it conflicts with a specific verifiable fact. INVESTIGATIVE LEAD EXCLUSION: investigative leads are excluded from this evidence packet. Do not infer anything about the subject from their absence. FINDING ATTRIBUTION RULE: when comparing or interpreting finding collections, attribute only direct-subject findings to the audited subject. A claim targeting an associate or venture cannot contradict the subject's claims unless separate direct-subject evidence explicitly connects the conduct to the subject. Never rewrite an associate's allegation as the subject's allegation. This attribution rule is specific to finding collections; profile, team, wallet, check-outcome, and other non-finding evidence in the packet remain legitimate evidence for testing the subject's claims.";
  const user = `Subject: ${handle}

Collected evidence (JSON):
${evidenceJson}`;
  const tool = {
    name: "record_contradictions",
    description: "Record internal contradictions between the subject's claims and the collected evidence.",
    input_schema: {
      type: "object",
      properties: {
        contradictions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              claim: { type: "string", description: "what the subject asserts" },
              conflict: { type: "string", description: "the specific evidence that contradicts it" },
              severity: { type: "string", enum: ["low", "medium", "high"] },
              confidence: { type: "string", enum: ["low", "medium", "high"] }
            },
            required: ["claim", "conflict", "severity", "confidence"]
          }
        }
      },
      required: ["contradictions"]
    }
  };
  const timeoutMs = typeof options.deadlineAt === "number" ? Math.min(6e4, Math.max(0, options.deadlineAt - Date.now())) : 6e4;
  if (timeoutMs < 1e3) {
    console.warn("[agent-runtime]", JSON.stringify({
      tool: "record_contradictions",
      state: "contradictions_skipped_budget",
      remainingMs: timeoutMs
    }));
    return null;
  }
  const r = await structured(
    system,
    user,
    tool,
    2048,
    timeoutMs
  );
  if (!r) return null;
  return (r.contradictions ?? []).filter((c) => c && c.claim?.trim() && c.conflict?.trim()).map((c) => ({ claim: c.claim.trim(), conflict: c.conflict.trim(), severity: lvl(c.severity), confidence: lvl(c.confidence) })).slice(0, 10);
}
var PROJECT_SCORING_POLICY = [
  "PROJECT CALIBRATION POLICY:",
  "Keep score and confidence separate. Score what substantive evidence establishes about project quality and risk. Record missing, unavailable, stale, or uncollected information in coverageRefs and gaps; those items reduce decision readiness outside this scorer and are not counter-evidence.",
  "Never subtract points merely because a provider did not run, a database returned no record, a licensed identity lookup missed, or a fact was not collected. Never charge the same gap against several axes. A material gap may keep an otherwise strong axis out of the exceptional band, but a gap alone must not push solid verified fundamentals into the mixed or adverse bands.",
  "Use the same evidence-strength bands on every project axis: 85 to 100 percent means exceptional, broad, current verification; 70 to 84 percent means solid verified fundamentals; 40 to 69 percent means an emerging, source-backed project with real but still limited demonstrated maturity or scale; 0 to 39 percent requires a severe verified weakness, contradiction, misconduct, or failure. Missing coverage is separate and never creates or lowers a strength tier.",
  "If an axis has neither affirmative evidence nor verified adverse evidence, do not score it at zero. Mark it unscored and publish the investigation as INCOMPLETE. A zero is a severe assessment, not a synonym for missing data.",
  "P1 team and identity: named founders or leaders, a verified official account or domain, and a verified operating or legal entity are strong evidence. Missing LinkedIn profiles, full legal names, or a complete staff directory are confidence gaps, not evidence that a publicly named team is weak or anonymous.",
  "P2 product substance: a live product, first-party documentation, public source repositories, current releases, and independent evidence of operation justify a strong score. A missing whitepaper or audit can limit the exceptional band, but must not erase a verified working product.",
  "P3 token conduct: verified canonical token identity, healthy observable market activity, and no verified adverse conduct justify a solid score. Reserve the exceptional band for verified token economics plus an independent security review. An unknown unlock schedule is a gap, not evidence of dumping or manipulation.",
  "P4 backing and partners: score source-backed integrations, counterparties, ecosystem partners, backers, and investors. Independent reporting can establish a solid relationship; reserve the exceptional band for direct counterparty, first-party, or multi-source corroboration. Venture funding is not required. A bootstrapped project is not weaker merely because no VC round was found, and a checked-empty funding search is not counter-evidence when meaningful partnerships are verified.",
  "P5 traction and liveness: current product activity plus concrete usage, volume, users, fees, TVL, transactions, or other market metrics justify a strong score. Social posting alone is only mild support, but verified live usage must not be reduced to moderate merely because another metric was not collected.",
  "A severe canonical-token market drawdown is material counter-evidence for P5 and must be cited, but price performance alone only caps otherwise exceptional traction and liveness at the solid band. It cannot erase verified current protocol usage or imply token misconduct.",
  "P6 transparency and integrity: a named legal operator, terms, public docs or repositories, governance materials, and consistent current disclosures justify a solid score. Published independent audits, treasury reporting, and fuller financial disclosures may justify the exceptional band. An unavailable disclosure path is a confidence gap unless a direct verified search establishes a material nondisclosure.",
  "Only cite substantive counterEvidenceRefs for distinct verified facts that pull a score below its evidence-strength band. A verified adverse fact may be primary support for an adverse band, but positive support and score-limiting counter-evidence must otherwise remain separate citations. An emerging score reflects limited demonstrated maturity or scale and does not require adverse evidence. Never use absence wording or operational coverage telemetry as a reason to lower a band."
].join("\n");
var FOUNDER_SCORING_POLICY = [
  "FOUNDER CALIBRATION POLICY:",
  "Keep score and confidence separate. Score source-backed identity, operating history, products, outcomes, conduct, and network quality. Record unavailable, stale, checked-empty, or uncollected information in coverageRefs and gaps. Missing coverage is not counter-evidence and never erases a verified fact.",
  "F1 identity verifiability: a fetched first-party organization page, regulator or institutional counterparty record, or two independent fetched sources can establish identity and current authority. A People Data Labs miss, an empty exact-name news query, or a missing personal GitHub profile is only a coverage gap.",
  "F2 track record: use verified founder and executive relationships, prior roles, products, launches, exits, and concrete operating outcomes. Follower count, posting cadence, profile biography, fame, and X follow relationships never establish a founder role or track record.",
  "F3 repeat backing: require actual source-backed financing, investor, or repeat-counterparty records across distinct events. Social follows, mutual follows, and generic affiliations are network context, not repeat backing.",
  "F4 build substance: verified live products, protocols, documentation, audits, usage, releases, or organization repositories establish build substance. A personal GitHub account is optional and its absence cannot negate a verified live product.",
  "F5 reputation and integrity: use direct-subject, source-verified conduct, legal, regulatory, sanctions, governance, or conflict evidence. A completed clear screen is coverage context, not affirmative character evidence, and an unavailable screen is not adverse evidence.",
  "F6 network quality: use observed professional relationships and notable network evidence only for network quality. Never transfer that evidence into identity, track record, repeat backing, or build substance.",
  "Preserve the entity named by each source. A person may be CEO of an operating company and founder of a related protocol; do not transfer the company title onto the protocol or DAO."
].join("\n");
function scoringPolicyForAxes(axisCatalog2) {
  return [
    ...axisCatalog2.some(({ role }) => role === "PROJECT") ? [PROJECT_SCORING_POLICY] : [],
    ...axisCatalog2.some(({ role }) => role === "FOUNDER") ? [FOUNDER_SCORING_POLICY] : []
  ].join("\n\n");
}
var RECORD_VERDICT_INPUT_SCHEMA = {
  type: "object",
  properties: {
    axes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          axis: { type: "string", description: "Exact axis ID from the requested axis list." },
          score: { type: "integer", description: "Integer score within the maximum listed for this axis." },
          rationale: { type: "string", description: "Tight evidence-grounded rationale for this axis." },
          primaryEvidenceRef: { type: "string", description: "One substantive citation alias eligible for this axis." },
          additionalEvidenceRefs: {
            type: "array",
            items: { type: "string" },
            description: "Zero to seven additional unique substantive citation aliases eligible for this axis."
          },
          counterEvidenceRefs: {
            type: "array",
            items: { type: "string" },
            description: "Zero to eight unique substantive citation aliases that credibly pull against this axis score."
          },
          coverageRefs: {
            type: "array",
            items: { type: "string" },
            description: "Zero to four checked-empty or unavailable aliases for this axis; return an empty array when none apply."
          },
          gaps: {
            type: "array",
            items: { type: "string" },
            description: "Zero to six unique descriptions of material unresolved evidence for this axis."
          }
        },
        required: [
          "axis",
          "score",
          "rationale",
          "primaryEvidenceRef",
          "additionalEvidenceRefs",
          "counterEvidenceRefs",
          "coverageRefs",
          "gaps"
        ],
        additionalProperties: false
      }
    },
    headline: { type: "string", description: "One non-empty sentence explaining what governs the composite verdict." },
    identity_note: { type: "string", description: "Non-empty identity resolution grounded in the collected evidence." }
  },
  required: ["axes", "headline", "identity_note"],
  additionalProperties: false
};
var ARTIFACT_ID = /^art_v1_[a-f0-9]{64}$/;
var COVERAGE_ONLY_VERIFICATIONS = /* @__PURE__ */ new Set(["checked_empty", "unavailable"]);
var isSubstantiveArtifact = (artifact) => !!artifact && !COVERAGE_ONLY_VERIFICATIONS.has(artifact.verification);
var GAP_MATCH_STOP_WORDS = /* @__PURE__ */ new Set([
  "about",
  "after",
  "again",
  "against",
  "available",
  "because",
  "before",
  "being",
  "check",
  "checked",
  "collection",
  "could",
  "coverage",
  "evidence",
  "failed",
  "failure",
  "found",
  "from",
  "incomplete",
  "material",
  "missing",
  "provider",
  "record",
  "result",
  "returned",
  "screen",
  "search",
  "source",
  "still",
  "through",
  "unavailable",
  "unknown",
  "unresolved",
  "without"
]);
var gapMatchTerms = (value) => new Set(
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).map((term) => term.trim()).filter((term) => term.length >= 5 && !GAP_MATCH_STOP_WORDS.has(term))
);
function coverageArtifactMatchesGap(artifact, gaps) {
  if (!artifact || gaps.length === 0) return false;
  const artifactTerms = gapMatchTerms([
    artifact.provider,
    artifact.operation,
    artifact.section,
    artifact.title,
    artifact.excerpt ?? ""
  ].join(" "));
  if (artifactTerms.size === 0) return false;
  return gaps.some((gap) => {
    const terms = gapMatchTerms(gap);
    return [...terms].some((term) => artifactTerms.has(term));
  });
}
var isVerifiedCounterArtifact = (artifact, axis) => artifact?.verification === "verified" && artifact.counterEligibleAxes?.includes(axis) === true;
var isOneTierCounterArtifact = (artifact) => artifact?.operation === "findings:ProjectTokenDrawdown";
var UNRESOLVED_TEAM_IDENTITY_CLAIM = /(?:\b(?:identity|founders?|co-?founders?|team|leadership|operators?|executives?|leaders?)\b(?:\s+[\w-]+){0,7}\s+\b(?:remains?|is|are|was|were|appears?)\s+(?:still\s+)?(?:unresolved|unnamed|anonymous|unknown|incomplete|absent|missing)\b)|(?:\b(?:identity|founders?|co-?founders?|team|leadership|operators?|executives?|leaders?)\b(?:\s+[\w-]+){0,7}\s+\b(?:could\s+not\s+be|has\s+not\s+been|have\s+not\s+been)\s+(?:identified|named|resolved|verified|confirmed|corroborated|surfaced|disclosed|enumerated)\b)|(?:\b(?:unresolved|unnamed|anonymous|unknown|incomplete|absent|missing)\b(?:\s+[\w-]+){0,7}\s+\b(?:identity|founders?|co-?founders?|team|leadership|operators?|executives?|leaders?)\b)|(?:\b(?:no|absent|absence\s+of|without|missing|lacks?)\s+(?:\w+\s+){0,6}(?:named\s+)?(?:identity|founders?|co-?founders?|team|leadership|operators?|executives?|leaders?)\b)|(?:\babsence\s+of\s+named\s+(?:founders?|co-?founders?|team|leadership|operators?|executives?|leaders?)\b)|(?:\b(?:named\s+)?(?:founders?|co-?founders?|team|leadership|operators?|executives?|leaders?)\b(?:\s+[\w-]+){0,7}\s+\b(?:(?:is|are|was|were)\s+)?not\s+(?:surfaced|disclosed|present|identified|named|resolved|verified|confirmed|corroborated|enumerated)\b)/i;
var describesGroundedTeamAsUnresolved = (value) => {
  if (UNRESOLVED_TEAM_IDENTITY_CLAIM.test(value)) return true;
  const normalized4 = value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  return /\bnamed\s+(?:founders?|co\s+founders?|leaders?|leadership|team|executives?|ceo)(?:\s+\w+){0,12}\s+not\s+(?:surfaced|disclosed|present|identified|named|resolved|verified|confirmed|corroborated|enumerated)\b/.test(normalized4);
};
var UNVERIFIED_FOUNDER_ROLE_CLAIMS = [
  /\b(?:founder(?:ship)?|co[- ]?founder|chief executive|ceo|current\s+(?:operating\s+)?role|operating\s+role|founder\s+relationship)\b[^.!?]{0,140}\b(?:alleged|claimed|inferred|purported|self[- ]?(?:described|reported)|unconfirmed|uncorroborated|unresolved|unverified|not\s+(?:independently\s+)?(?:confirmed|corroborated|verified))\b/i,
  /\b(?:alleged|claimed|purported|self[- ]?(?:described|reported)|unconfirmed|uncorroborated|unverified)\b[^.!?]{0,100}\b(?:founder|co[- ]?founder|chief executive|ceo|current\s+(?:operating\s+)?role)\b/i,
  /\b(?:presents?|positions?)\s+(?:himself|herself|themself|themselves|the\s+subject)?\s*as\b[^.!?]{0,100}\b(?:founder|co[- ]?founder|chief executive|ceo)\b/i,
  /\b(?:identity|current\s+role|operating\s+role|founder\s+status)\b[^.!?]{0,100}\b(?:formally\s+)?(?:remains?\s+)?(?:unresolved|unverified|unconfirmed|uncorroborated)\b/i
];
var SOCIAL_ONLY_TRACK_RECORD_CLAIM = /(?:\btrack\s+record\b[^.!?]{0,220}\b(?:inferred|rests?\s+on|based\s+(?:only|primarily)\s+on|not\s+independently\s+(?:verified|corroborated))\b[^.!?]{0,220}\b(?:claimed\s+role|follower(?:s|\s+base|\s+count)?|social\s+(?:graph|reach)|profile\s+bio)|\b(?:claimed\s+role|follower(?:s|\s+base|\s+count)?|social\s+(?:graph|reach))\b[^.!?]{0,220}\b(?:rather\s+than|without)\b[^.!?]{0,120}\b(?:independent|verified|source-backed)\s+(?:artifacts?|evidence|sources?)\b)/i;
var describesGroundedFounderRoleAsUnverified = (value) => UNVERIFIED_FOUNDER_ROLE_CLAIMS.some((claim) => claim.test(value));
var describesGroundedTrackRecordAsSocialOnly = (value) => SOCIAL_ONLY_TRACK_RECORD_CLAIM.test(value);
var FOUNDER_SOCIAL_EVIDENCE = /\b(?:followers?|follower\s+(?:base|count)|follow\s+graph|mutual\s+follows?|notable\s+followers?|posting\s+cadence|profile\s+bio(?:graphy)?|social\s+(?:graph|reach))\b/i;
var FOUNDER_OPERATING_FUNDAMENTAL = /\b(?:track\s+record|operating\s+history|operating\s+track\s+record|repeat\s+backing|venture\s+outcomes?|founder\s+history)\b/i;
var SOCIAL_SUPPORT_VERB = /\b(?:establish(?:es|ed)?|support(?:s|ed)?|prove(?:s|d)?|demonstrat(?:e[sd]?|ed)|confirm(?:s|ed)?|validate(?:s|d)?|evidence(?:s|d)?|show(?:s|ed)?)\b/i;
var SOCIAL_SUPPORT_NEGATION = /\b(?:do|does|did|can|could|would|should)\s+not\s+(?:itself\s+)?(?:directly\s+)?(?:establish|support|prove|demonstrate|confirm|validate|evidence|show)\b|\b(?:cannot|can't|never|insufficient\s+to|not\s+enough\s+to)\s+(?:itself\s+)?(?:directly\s+)?(?:establish|support|prove|demonstrate|confirm|validate|evidence|show)\b|\b(?:is|are|was|were)\s+not\s+(?:established|supported|proven|demonstrated|confirmed|validated|evidenced|shown)\s+(?:by|from)\b/i;
var founderFundamentalsAffirmativelyRelyOnSocial = (value) => value.split(/[.!?]+/).some((sentence) => {
  if (!FOUNDER_SOCIAL_EVIDENCE.test(sentence) || !FOUNDER_OPERATING_FUNDAMENTAL.test(sentence) || SOCIAL_SUPPORT_NEGATION.test(sentence)) return false;
  const social = FOUNDER_SOCIAL_EVIDENCE.exec(sentence);
  const fundamental = FOUNDER_OPERATING_FUNDAMENTAL.exec(sentence);
  if (!social || social.index === void 0 || !fundamental || fundamental.index === void 0) return false;
  const support = SOCIAL_SUPPORT_VERB.exec(sentence);
  if (support?.index !== void 0) {
    return social.index < support.index && support.index < fundamental.index;
  }
  return fundamental.index < social.index && /\b(?:based|grounded|rest(?:s|ed)?|founded)\s+(?:on|in)\b/i.test(
    sentence.slice(fundamental.index, social.index)
  );
});
var ABSENT_NOTABLE_FOLLOWERS_CLAIM = /(?:\b(?:no|zero)\s+(?:named\s+|verified\s+|documented\s+|structured\s+|observed\s+)?notable\s+followers?\b|\b(?:absence|lack|missing)\s+of\s+(?:named\s+|verified\s+|documented\s+|observed\s+)?notable\s+followers?\b|\bnotable\s+followers?\b(?:\s+[\w-]+){0,10}\s+(?:are|were|remain)?\s*not\s+(?:listed|documented|present|included|provided|available|observed|surfaced)\b|\b(?:notable\s+followers?|observed\s+network)(?:\s+(?:evidence|data|array|list|collection|section))?\s+(?:is|was|remains?)\s+(?:empty|absent|missing|unavailable|not\s+present)\b|\bnone\b(?:\s+[\w-]+){0,8}\s+notable\s+followers?\b|\bno\s+direct\s+observed\s+network\s+evidence\b)/i;
var describesGroundedNotableFollowersAsAbsent = (value) => ABSENT_NOTABLE_FOLLOWERS_CLAIM.test(value);
function normalizeAnalystSupportCounterOverlap(value, evidenceCatalog, projectScoreBands = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const root = value;
  const aliasToArtifactId = new Map(
    evidenceCatalog.map((artifact, index) => [
      `e${String(index + 1).padStart(3, "0")}`,
      artifact.artifactId
    ])
  );
  const refKey = (ref) => {
    if (typeof ref !== "string") return null;
    const alias = /^e\d+$/i.test(ref) ? ref.toLowerCase() : ref;
    return aliasToArtifactId.get(alias) ?? alias;
  };
  const normalizeRow = (candidate, axisHint) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return candidate;
    const row = candidate;
    if (typeof row.primaryEvidenceRef !== "string" || !Array.isArray(row.additionalEvidenceRefs) || !Array.isArray(row.counterEvidenceRefs)) return candidate;
    const axis = typeof row.axis === "string" ? row.axis : axisHint;
    const counterKeys = new Set(row.counterEvidenceRefs.map(refKey).filter((ref) => !!ref));
    const support = [row.primaryEvidenceRef, ...row.additionalEvidenceRefs];
    if (axis && projectScoreBands[axis]?.tier === "adverse") {
      const supportKeys = new Set(support.map(refKey).filter((ref) => !!ref));
      const disjointCounter = row.counterEvidenceRefs.filter((ref) => {
        const key = refKey(ref);
        return !key || !supportKeys.has(key);
      });
      return disjointCounter.length === row.counterEvidenceRefs.length ? candidate : { ...row, counterEvidenceRefs: disjointCounter };
    }
    const disjointSupport = support.filter((ref) => {
      const key = refKey(ref);
      return !key || !counterKeys.has(key);
    });
    if (disjointSupport.length === support.length) return candidate;
    if (disjointSupport.length === 0) return candidate;
    return {
      ...row,
      primaryEvidenceRef: disjointSupport[0],
      additionalEvidenceRefs: disjointSupport.slice(1)
    };
  };
  if (Array.isArray(root.axes)) {
    const rawAxes = root.axes;
    const axes = rawAxes.map((row) => normalizeRow(row));
    return axes.some((axis, index) => axis !== rawAxes[index]) ? { ...root, axes } : value;
  }
  if (root.axes && typeof root.axes === "object" && !Array.isArray(root.axes)) {
    const entries = Object.entries(root.axes);
    let changed = false;
    const axes = Object.fromEntries(entries.map(([axis, row]) => {
      const normalized4 = normalizeRow(row, axis);
      changed ||= normalized4 !== row;
      return [axis, normalized4];
    }));
    return changed ? { ...root, axes } : value;
  }
  return value;
}
function normalizeAnalystCitationEligibility(value, evidenceCatalog) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const root = value;
  const aliasToArtifact = /* @__PURE__ */ new Map();
  evidenceCatalog.forEach((artifact, index) => {
    aliasToArtifact.set(artifact.artifactId, artifact);
    aliasToArtifact.set(`e${String(index + 1).padStart(3, "0")}`, artifact);
  });
  const artifactFor = (ref) => {
    if (typeof ref !== "string") return void 0;
    const key = /^e\d+$/i.test(ref) ? ref.toLowerCase() : ref;
    return aliasToArtifact.get(key);
  };
  const eligibleValues = (values, axis, substantive) => {
    return values.flatMap((value2) => {
      if (typeof value2 !== "string") return [];
      const artifact = artifactFor(value2);
      if (!artifact || !artifact.eligibleAxes.includes(axis) || isSubstantiveArtifact(artifact) !== substantive) return [];
      return [value2];
    });
  };
  const normalizeRow = (candidate, axisHint) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return candidate;
    const row = candidate;
    const axis = typeof row.axis === "string" ? row.axis : axisHint;
    if (!axis || typeof row.primaryEvidenceRef !== "string" || !Array.isArray(row.additionalEvidenceRefs) || !Array.isArray(row.counterEvidenceRefs) || !Array.isArray(row.coverageRefs)) return candidate;
    const support = eligibleValues([row.primaryEvidenceRef, ...row.additionalEvidenceRefs], axis, true);
    if (!support.length) return candidate;
    const supportIds = new Set(support.map((ref) => artifactFor(ref).artifactId));
    const counter = eligibleValues(row.counterEvidenceRefs, axis, true).filter((ref) => !supportIds.has(artifactFor(ref).artifactId));
    const coverage = eligibleValues(row.coverageRefs, axis, false);
    const changed = support[0] !== row.primaryEvidenceRef || support.length - 1 !== row.additionalEvidenceRefs.length || counter.length !== row.counterEvidenceRefs.length || coverage.length !== row.coverageRefs.length;
    return changed ? {
      ...row,
      primaryEvidenceRef: support[0],
      additionalEvidenceRefs: support.slice(1),
      counterEvidenceRefs: counter,
      coverageRefs: coverage
    } : candidate;
  };
  if (Array.isArray(root.axes)) {
    const rawAxes = root.axes;
    const axes = rawAxes.map((row) => normalizeRow(row));
    return axes.some((axis, index) => axis !== rawAxes[index]) ? { ...root, axes } : value;
  }
  if (root.axes && typeof root.axes === "object" && !Array.isArray(root.axes)) {
    const entries = Object.entries(root.axes);
    let changed = false;
    const axes = Object.fromEntries(entries.map(([axis, row]) => {
      const normalized4 = normalizeRow(row, axis);
      changed ||= normalized4 !== row;
      return [axis, normalized4];
    }));
    return changed ? { ...root, axes } : value;
  }
  return value;
}
function validateAnalystVerdict(value, axisCatalog2, evidenceCatalog = [], onReject, options = {}) {
  const reject = (reason) => {
    onReject?.(reason);
    return null;
  };
  if (!value || typeof value !== "object" || Array.isArray(value) || !axisCatalog2.length || !evidenceCatalog.length) {
    return reject("invalid-root-or-catalog");
  }
  const raw = value;
  if (Object.keys(value).some((key) => !["axes", "headline", "identity_note"].includes(key))) {
    return reject("root-extra-field");
  }
  const headline = typeof raw.headline === "string" ? raw.headline.trim() : "";
  const identityNote = typeof raw.identity_note === "string" ? raw.identity_note.trim() : "";
  if (!headline || !identityNote) return reject("blank-headline-or-identity-note");
  const expected = /* @__PURE__ */ new Map();
  for (const spec of axisCatalog2) {
    if (!spec.axis || expected.has(spec.axis) || !Number.isInteger(spec.weight) || spec.weight < 0) {
      return reject("invalid-axis-catalog");
    }
    expected.set(spec.axis, spec);
  }
  const artifacts = /* @__PURE__ */ new Map();
  for (const artifact of evidenceCatalog) {
    if (!ARTIFACT_ID.test(artifact.artifactId) || artifacts.has(artifact.artifactId) || artifact.contentHash !== artifact.artifactId.slice("art_v1_".length) || !Array.isArray(artifact.eligibleAxes)) return reject("invalid-evidence-catalog");
    artifacts.set(artifact.artifactId, artifact);
  }
  const hasGroundedProjectTeam = expected.has("P1_team_and_identity") && evidenceCatalog.some((artifact) => artifact.eligibleAxes.includes("P1_team_and_identity") && isSubstantiveArtifact(artifact) && (artifact.section === "team" || artifact.section === "checkOutcomes" && artifact.operation === "checkOutcomes:project-team-identity"));
  const axisNarrative = JSON.stringify(raw.axes ?? "");
  if (hasGroundedProjectTeam && (describesGroundedTeamAsUnresolved(headline) || describesGroundedTeamAsUnresolved(identityNote) || describesGroundedTeamAsUnresolved(axisNarrative))) {
    return reject("grounded-team-described-as-unresolved");
  }
  const hasFounderAxis = [...expected.values()].some((axis) => axis.role === "FOUNDER");
  const rawAxisRow = (axis) => {
    if (Array.isArray(raw.axes)) {
      return raw.axes.find((candidate) => candidate && typeof candidate === "object" && !Array.isArray(candidate) && candidate.axis === axis);
    }
    return raw.axes && typeof raw.axes === "object" && !Array.isArray(raw.axes) ? raw.axes[axis] : void 0;
  };
  const networkMisusedForFounderFundamentals = ["F2_track_record", "F3_repeat_backing"].filter((axis) => expected.get(axis)?.role === "FOUNDER").some((axis) => founderFundamentalsAffirmativelyRelyOnSocial(
    JSON.stringify(rawAxisRow(axis) ?? "")
  ));
  if (networkMisusedForFounderFundamentals) {
    return reject("founder-fundamentals-cite-network-only-evidence");
  }
  const hasGroundedFounderRole = hasFounderAxis && evidenceCatalog.some((artifact) => artifact.verification === "verified" && (artifact.operation === "basicFacts:founder" || artifact.operation === "checkOutcomes:founder-company-relationships"));
  if (hasGroundedFounderRole && (describesGroundedFounderRoleAsUnverified(headline) || describesGroundedFounderRoleAsUnverified(identityNote) || describesGroundedFounderRoleAsUnverified(axisNarrative))) {
    return reject("grounded-founder-role-described-as-unverified");
  }
  const hasGroundedFounderTrackRecord = hasFounderAxis && evidenceCatalog.some((artifact) => artifact.verification === "verified" && (artifact.section === "basicFacts" && [
    "basicFacts:founder",
    "basicFacts:founded",
    "basicFacts:prior_role",
    "basicFacts:product",
    "basicFacts:launched",
    "basicFacts:exit",
    "basicFacts:track_record",
    "basicFacts:traction"
  ].includes(artifact.operation) || artifact.section === "checkOutcomes" && artifact.operation === "checkOutcomes:founder-track-record"));
  if (hasFounderAxis && (describesGroundedTrackRecordAsSocialOnly(headline) || describesGroundedTrackRecordAsSocialOnly(identityNote) || describesGroundedTrackRecordAsSocialOnly(axisNarrative))) {
    return reject(hasGroundedFounderTrackRecord ? "grounded-founder-track-record-described-as-social-only" : "founder-track-record-described-as-social-only");
  }
  const hasGroundedNotableFollowers = expected.has("F6_network_quality") && evidenceCatalog.some((artifact) => artifact.section === "notableFollowers" && artifact.eligibleAxes.includes("F6_network_quality") && isSubstantiveArtifact(artifact));
  if (hasGroundedNotableFollowers && (describesGroundedNotableFollowersAsAbsent(headline) || describesGroundedNotableFollowersAsAbsent(identityNote) || describesGroundedNotableFollowersAsAbsent(axisNarrative))) {
    return reject("grounded-notable-followers-described-as-absent");
  }
  const artifactIdByAlias = new Map(
    evidenceCatalog.map((artifact, index) => [
      `e${String(index + 1).padStart(3, "0")}`,
      artifact.artifactId
    ])
  );
  const resolveRef = (value2) => {
    const alias = /^e\d+$/i.test(value2) ? value2.toLowerCase() : value2;
    return artifactIdByAlias.get(alias) ?? value2;
  };
  let keyedAxes = false;
  const keyedRowKeys = /* @__PURE__ */ new Map();
  let candidates;
  if (Array.isArray(raw.axes)) {
    if (raw.axes.length !== axisCatalog2.length) return reject("axis-count");
    candidates = raw.axes;
  } else if (raw.axes && typeof raw.axes === "object") {
    keyedAxes = true;
    const rows = raw.axes;
    const keys = Object.keys(rows);
    if (keys.length !== expected.size || keys.some((key) => !expected.has(key))) {
      return reject("axis-key-set");
    }
    candidates = axisCatalog2.map((spec) => {
      const candidate = rows[spec.axis];
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return candidate;
      keyedRowKeys.set(spec.axis, Object.keys(candidate));
      return { ...candidate, axis: spec.axis };
    });
  } else {
    return reject("axis-shape");
  }
  const validRefs = (value2, min, max) => {
    if (!Array.isArray(value2) || value2.length < min || value2.length > max) return null;
    if (!value2.every((item) => typeof item === "string")) return null;
    const refs = value2.map(resolveRef);
    if (!refs.every((item) => ARTIFACT_ID.test(item))) return null;
    return new Set(refs).size === refs.length ? [...refs] : null;
  };
  const validGaps = (value2) => {
    if (!Array.isArray(value2) || value2.length > 6) return null;
    const gaps = value2.map((item) => typeof item === "string" ? item.trim() : "");
    if (gaps.some((gap) => !gap || gap.length > 400) || new Set(gaps).size !== gaps.length) return null;
    return gaps;
  };
  const seen = /* @__PURE__ */ new Map();
  const outOfBandProjectScores = [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return reject("axis-row-shape");
    }
    const row = candidate;
    if (typeof row.axis !== "string" || typeof row.score !== "number" || typeof row.rationale !== "string" || !row.rationale.trim()) return reject("axis-row-required-fields");
    const spec = expected.get(row.axis);
    if (!spec) return reject(`unknown-axis:${row.axis}`);
    if (seen.has(row.axis)) return reject(`duplicate-axis:${row.axis}`);
    if (!Number.isInteger(row.score) || row.score < 0 || row.score > spec.weight) {
      return reject(`score-out-of-range:${row.axis}`);
    }
    const primary = typeof row.primaryEvidenceRef === "string" ? resolveRef(row.primaryEvidenceRef) : "";
    const additional = validRefs(row.additionalEvidenceRefs, 0, 7);
    const hasCoverageCandidates = [...artifacts.values()].some((artifact) => COVERAGE_ONLY_VERIFICATIONS.has(artifact.verification) && artifact.eligibleAxes.includes(row.axis));
    const allowedFields = /* @__PURE__ */ new Set([
      ...keyedAxes ? [] : ["axis"],
      "score",
      "rationale",
      "primaryEvidenceRef",
      "additionalEvidenceRefs",
      "counterEvidenceRefs",
      "gaps",
      ...!keyedAxes || hasCoverageCandidates ? ["coverageRefs"] : []
    ]);
    const rowKeys = keyedAxes ? keyedRowKeys.get(row.axis) ?? [] : Object.keys(candidate);
    if (rowKeys.some((key) => !allowedFields.has(key))) {
      return reject(`axis-row-extra-field:${row.axis}`);
    }
    if (keyedAxes && hasCoverageCandidates && row.coverageRefs === void 0 || keyedAxes && !hasCoverageCandidates && row.coverageRefs !== void 0 || !keyedAxes && row.coverageRefs === void 0) {
      return reject(`coverage-field-shape:${row.axis}`);
    }
    const rawCoverage = row.coverageRefs === void 0 ? [] : row.coverageRefs;
    if (Array.isArray(rawCoverage) && rawCoverage.length > 4) {
      return reject(`coverage-reference-limit-observed-${rawCoverage.length}-max-4:${row.axis}`);
    }
    const coverage = validRefs(rawCoverage, 0, 4);
    if (!ARTIFACT_ID.test(primary)) return reject(`primary-reference-shape:${row.axis}`);
    if (!additional) return reject(`additional-reference-shape:${row.axis}`);
    if (!coverage) return reject(`coverage-reference-shape:${row.axis}`);
    const supportRefs = [primary, ...additional];
    const coverageRefs = coverage;
    const allSelectedEvidenceRefs = [...supportRefs, ...coverageRefs];
    if (new Set(allSelectedEvidenceRefs).size !== allSelectedEvidenceRefs.length) {
      return reject(`duplicate-evidence-reference:${row.axis}`);
    }
    const counterEvidenceRefs = validRefs(row.counterEvidenceRefs, 0, 8);
    const gaps = validGaps(row.gaps);
    if (allSelectedEvidenceRefs.length > 12 || !counterEvidenceRefs || !gaps) {
      return reject(`axis-arrays-invalid:${row.axis}`);
    }
    if (spec.role === "PROJECT" && row.axis === "P4_backing_and_partners") {
      const frozenRelationshipPress = [...artifacts.values()].some((artifact) => {
        if (!artifact.eligibleAxes.includes("P4_backing_and_partners")) return false;
        if (artifact.verification === "unavailable") return false;
        const text2 = `${artifact.title} ${artifact.excerpt ?? ""}`;
        return MATERIAL_RELATIONSHIP_PRESS.test(text2) && !MATERIAL_RELATIONSHIP_DENIAL.test(text2);
      });
      const collectionStatusGap = gaps.some((gap) => /\b(?:partner|integrat|counterpart)/i.test(gap) && /\bnot\s+collected\b/i.test(gap));
      if (frozenRelationshipPress && collectionStatusGap) {
        return reject(`relationship-press-described-as-uncollected:${row.axis}`);
      }
    }
    if (counterEvidenceRefs.some((ref) => allSelectedEvidenceRefs.includes(ref))) {
      return reject(`support-counter-overlap:${row.axis}`);
    }
    const everyRefEligible = [...allSelectedEvidenceRefs, ...counterEvidenceRefs].every((ref) => {
      const artifact = artifacts.get(ref);
      return artifact?.eligibleAxes.includes(row.axis);
    });
    if (!everyRefEligible) return reject(`axis-ineligible-reference:${row.axis}`);
    if (!supportRefs.some((ref) => isSubstantiveArtifact(artifacts.get(ref)))) {
      return reject(`missing-substantive-support:${row.axis}`);
    }
    if (!supportRefs.every((ref) => isSubstantiveArtifact(artifacts.get(ref)))) {
      return reject(`non-substantive-support:${row.axis}`);
    }
    if (!coverageRefs.every((ref) => !isSubstantiveArtifact(artifacts.get(ref)))) {
      return reject(`substantive-coverage-reference:${row.axis}`);
    }
    const hasUnavailableCoverage = coverageRefs.some((ref) => artifacts.get(ref)?.verification === "unavailable");
    if (hasUnavailableCoverage && gaps.length === 0) {
      return reject(`coverage-without-gap:${row.axis}`);
    }
    const linkedCoverageRefs = coverageRefs.filter((ref) => coverageArtifactMatchesGap(artifacts.get(ref), gaps));
    const evidenceRefs = [...supportRefs, ...linkedCoverageRefs];
    if (!counterEvidenceRefs.every((ref) => isSubstantiveArtifact(artifacts.get(ref)))) {
      return reject(`non-substantive-counter-reference:${row.axis}`);
    }
    if (spec.role === "PROJECT" && !counterEvidenceRefs.every((ref) => isVerifiedCounterArtifact(artifacts.get(ref), row.axis))) {
      return reject(`project-counter-reference-not-score-limiting:${row.axis}`);
    }
    const projectBand = options.projectScoreBands?.[row.axis];
    const requiredBoundedCounters = [...artifacts.values()].filter((artifact) => isOneTierCounterArtifact(artifact) && isVerifiedCounterArtifact(artifact, row.axis));
    if (spec.role === "PROJECT" && projectBand?.tier !== "adverse" && requiredBoundedCounters.some((artifact) => !counterEvidenceRefs.includes(artifact.artifactId))) {
      return reject(`project-required-counter-reference-missing:${row.axis}`);
    }
    const verifiedCounterArtifacts = counterEvidenceRefs.map((ref) => artifacts.get(ref)).filter((artifact) => isVerifiedCounterArtifact(artifact, row.axis));
    const hasVerifiedCounterEvidence = verifiedCounterArtifacts.length > 0 || projectBand?.tier === "adverse" && supportRefs.some((ref) => isVerifiedCounterArtifact(artifacts.get(ref), row.axis));
    const hasSevereCounterEvidence = verifiedCounterArtifacts.some((artifact) => !isOneTierCounterArtifact(artifact));
    if (spec.role === "PROJECT" && options.projectScoreBands && (!projectBand || projectBand.tier === "none" || row.score > projectBand.maxScore || projectBand.tier !== "adverse" && row.score < projectBand.minScore && (!hasVerifiedCounterEvidence || !hasSevereCounterEvidence))) outOfBandProjectScores.push(row.axis);
    seen.set(row.axis, {
      axis: row.axis,
      score: row.score,
      rationale: row.rationale.trim(),
      evidenceRefs,
      counterEvidenceRefs,
      gaps
    });
  }
  if (seen.size !== expected.size) return reject("incomplete-axis-set");
  if (outOfBandProjectScores.length > 0) {
    return reject(`project-scores-outside-evidence-strength-band:${outOfBandProjectScores.join(",")}`);
  }
  return {
    // Canonical order makes downstream completeness checks and snapshots stable.
    axes: axisCatalog2.map((spec) => seen.get(spec.axis)),
    headline,
    identity_note: identityNote
  };
}
var ANALYST_EVIDENCE_MAX_CHARS = 24e3;
var SCORING_PACKET_STATE_FIELD = "scoring_packet_state";
var SCORING_PACKET_OVERSIZE = "oversize";
var scoringPacketOversizeJson = (requestedAxisCount, reason) => JSON.stringify({
  schema_version: 5,
  [SCORING_PACKET_STATE_FIELD]: SCORING_PACKET_OVERSIZE,
  reason,
  limit_chars: ANALYST_EVIDENCE_MAX_CHARS,
  requested_axis_count: requestedAxisCount,
  evidenceCatalog: []
});
var clip = (value, max) => {
  if (typeof value !== "string") return void 0;
  return value.length <= max ? value : value.slice(0, max) + "\u2026";
};
var compactObject = (value, depth = 0) => {
  if (value == null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return clip(value, 320);
  if (depth >= 3) return void 0;
  if (Array.isArray(value)) return value.slice(0, 8).map((item) => compactObject(item, depth + 1)).filter((item) => item !== void 0);
  if (typeof value !== "object") return void 0;
  return Object.fromEntries(
    Object.entries(value).slice(0, 24).map(([key, item]) => [key, compactObject(item, depth + 1)]).filter(([, item]) => item !== void 0)
  );
};
var SCORING_PROFILE_FIELDS = [
  "handle",
  "display_name",
  "resolved_name",
  "bio",
  "website",
  "profile_collection_state",
  "profile_provider",
  "profile_captured_at",
  "last_post_at",
  "days_since_post"
];
var compactScoringProfile = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return void 0;
  const row = value;
  const prioritized = Object.fromEntries(SCORING_PROFILE_FIELDS.flatMap((key) => {
    const compacted = compactObject(row[key], 1);
    return compacted === void 0 ? [] : [[key, compacted]];
  }));
  const remainder = compactObject(value);
  return remainder && typeof remainder === "object" && !Array.isArray(remainder) ? { ...remainder, ...prioritized } : prioritized;
};
var compactProjectToken = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return void 0;
  const row = value;
  const history = row.history && typeof row.history === "object" && !Array.isArray(row.history) ? row.history : void 0;
  return {
    ...Object.fromEntries(Object.entries(row).flatMap(([key, item]) => {
      if (key === "history") return [];
      const compacted = compactObject(item, 1);
      return compacted === void 0 ? [] : [[key, compacted]];
    })),
    ...history ? {
      history: Object.fromEntries([
        "first",
        "last",
        "peak",
        "changePct",
        "drawdownPct",
        "timeframe",
        "poolAddress"
      ].flatMap((key) => {
        const compacted = compactObject(history[key], 2);
        return compacted === void 0 ? [] : [[key, compacted]];
      }))
    } : {}
  };
};
var SOURCE_ARTIFACT_FIELDS = [
  "kind",
  "provider",
  "title",
  "sourceUrl",
  "capturedAt",
  "contentHash",
  "sourceContentHash",
  "publishedAt",
  "excerpt",
  "match",
  "coverageState",
  "relationship",
  "subjectName",
  "subjectHandle",
  "projectName",
  "projectHandle",
  "projectDomain",
  "sourceClass",
  "investorEntityName",
  "investorEntityHandle",
  "investorEntityDomain",
  "attribution",
  "attributionSourceUrl",
  "attributionSourceContentHash",
  "attributionCapturedAt",
  "attributionSourceKind",
  "investorDomainSourceUrl",
  "investorDomainSourceContentHash",
  "investorDomainCapturedAt",
  "investorDomainSourceKind",
  "investorDomainProfileName",
  "investorDomainProfileWebsite",
  "fundName",
  "fundSizeUsd",
  "fundVehicle",
  "fundScaleMetric",
  "fundAmountQualifier",
  "fundScaleBasis",
  "fundScaleAsOf",
  "fundScaleTemporalState",
  "fundScaleSourceCount",
  "fundScaleClaimId"
];
var compactSourceArtifact = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return void 0;
  const row = value;
  return Object.fromEntries(SOURCE_ARTIFACT_FIELDS.flatMap((key) => {
    const compacted = compactObject(row[key], 1);
    return compacted === void 0 ? [] : [[key, compacted]];
  }));
};
var MATERIAL_RELATIONSHIP_PRESS = /\b(?:partner(?:s|ed|ing|ship)?|integrat(?:e[ds]?|ion)|collaborat(?:e[ds]?|ion)|alliance|joint(?:ly)?|teams? up|backed by|invest(?:s|ed|ing|ment)|funding|launch(?:e[ds])?\s+(?:with|alongside)|adopt(?:s|ed|ion)?|taps|selects|(?:expand|extend)(?:s|ed|ing)?\s+(?!to\b|into\b|its\b|the\b)\S)\b/i;
var MULTI_PARTY_LAUNCH_PRESS = /^(?:[^,\n]{1,100},){2}[^,\n]{1,140}\blaunch(?:e[ds])?\b/i;
var MATERIAL_RELATIONSHIP_DENIAL = /\b(?:den(?:y|ies|ied)|rumou?r(?:ed|s)?|alleg(?:e[ds]?|ation)|reportedly|false|fake|no partnership|not (?:a |an )?(?:partner|investor|backer)|end(?:s|ed)? (?:its |the )?(?:partnership|integration|collaboration)|terminat(?:e[ds]?|ion))\b/i;
var PROJECT_PRODUCT_PRESS = /\b(?:product|protocol|platform|exchange|app(?:lication)?|mainnet|testnet|launch(?:e[ds])?|releas(?:e[ds])?|ship(?:s|ped)?|deploy(?:s|ed|ment)|upgrade|integration|developer|repository|open[ -]?source)\b/i;
var PROJECT_TRACTION_PRESS = /\b(?:active users?|daily users?|monthly users?|transactions?|trading volume|volume|fees?|revenue|tvl|total value locked|market share|adoption|usage|liquidity|deposits?|borrow(?:ing|ers?)?)\b/i;
var PROJECT_TRANSPARENCY_PRESS = /\b(?:governance|proposal|vote|audit|security review|security audit|treasury report|financial disclosure|disclosure|legal entity|terms of service|multisig|multi-sig|incident report)\b/i;
var isFreshPublishedArtifact = (artifact, maxAgeDays = 90) => {
  const publishedAt = Date.parse(String(artifact.publishedAt ?? ""));
  const capturedAt = Date.parse(String(artifact.capturedAt ?? ""));
  if (!Number.isFinite(publishedAt) || !Number.isFinite(capturedAt)) return false;
  const ageMs = capturedAt - publishedAt;
  return ageMs >= -864e5 && ageMs <= maxAgeDays * 864e5;
};
var datedMetricTimestamps = (fact) => {
  const sources = Array.isArray(fact.sources) ? fact.sources.filter((value) => !!value && typeof value === "object" && !Array.isArray(value)) : [];
  const text2 = [
    String(fact.qualifier ?? ""),
    String(fact.value ?? ""),
    ...sources.map((source2) => String(source2.excerpt ?? ""))
  ].join(" ");
  const matches = [
    ...text2.matchAll(/\b20\d{2}-\d{2}-\d{2}\b/g),
    ...text2.matchAll(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(?:\d{1,2},?\s+)?20\d{2}\b/gi)
  ];
  const quarters = [...text2.matchAll(/\bQ([1-4])\s+(20\d{2})\b/gi)].map((match) => {
    const quarter = Number(match[1]);
    const year = Number(match[2]);
    return Date.UTC(year, quarter * 3, 0);
  });
  return [
    ...matches.map((match) => Date.parse(match[0])).filter((timestamp) => Number.isFinite(timestamp)),
    ...quarters.filter((timestamp) => Number.isFinite(timestamp))
  ];
};
var hasFreshDatedMetric = (fact, referenceCapturedAt, maxAgeDays = 90) => datedMetricTimestamps(fact).some((timestamp) => {
  const ageMs = referenceCapturedAt - timestamp;
  return ageMs >= -864e5 && ageMs <= maxAgeDays * 864e5;
});
var relationshipStoryKey = (artifact) => {
  const headline = String(artifact.title ?? "").split(/\s+[|]\s+|\s+-\s+(?=[^-]+$)/)[0].toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  return headline || String(artifact.contentHash ?? artifact.sourceUrl ?? "").toLowerCase();
};
var sourceArtifactPriority = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 9;
  const row = value;
  if (row.kind === "fund_scale" && row.match === "fund_scale_confirmed") return 0;
  if (row.kind === "portfolio_relationship" && row.match === "relationship_confirmed") return 1;
  if (row.match === "risk_signal") return 2;
  if (row.kind === "fund_scale") return 3;
  if (row.kind === "portfolio_relationship") return 4;
  if (row.kind === "press" && !MATERIAL_RELATIONSHIP_DENIAL.test(`${String(row.title ?? "")} ${String(row.excerpt ?? "")}`) && (MATERIAL_RELATIONSHIP_PRESS.test(`${String(row.title ?? "")} ${String(row.excerpt ?? "")}`) || MULTI_PARTY_LAUNCH_PRESS.test(String(row.title ?? "")))) return 5;
  if (row.kind === "legal_case" || row.kind === "sanctions_screen" || row.kind === "trust_graph") return 5;
  return 6;
};
var retainSourceArtifacts = (source2, limit) => source2.map((value, index) => ({ value, index, priority: sourceArtifactPriority(value) })).sort((left, right) => left.priority - right.priority || left.index - right.index).slice(0, limit).map(({ value }) => value);
var PROJECT_EARLY_STAGE = /\b(?:alpha|beta|testnet|prototype|demo|pilot|coming soon|pre-?launch|waitlist)\b/i;
var PROJECT_MATURE_STAGE = /\b(?:live|mainnet|production|in production|operational|operating)\b/i;
var TOKEN_MARKET_ONLY_TRACTION = /\b(?:token|trading volume|volume|market cap|liquidity|price|fdv)\b/i;
var PROJECT_PROTOCOL_TRACTION = /\b(?:protocol|platform|exchange|aggregator|product|active users?|daily users?|monthly users?|transactions?|swaps?|orders?|fees?|revenue|tvl|total value locked|adoption|usage)\b/i;
var PROJECT_LEADER_TEAM_ROLE = /\b(?:co-?founder|founder|chief(?:\s+\w+){0,3}\s+officer|ceo|cto|cfo|coo|president|executive director|managing director|general manager|head of (?:engineering|product|operations|protocol|research))\b/i;
var PROJECT_PRODUCT_ACTIVITY = /\b(?:product|protocol|platform|exchange|app(?:lication)?|mainnet|testnet|launch(?:e[ds])?|releas(?:e[ds])?|ship(?:s|ped)?|deploy(?:s|ed|ment)|upgrade|integration|developer|repository|open[ -]?source)\b/i;
var trustedProjectProfileDaysSincePost = (profile) => {
  if (!profile || profile.profile_collection_state !== "resolved" || profile.profile_provider !== "twitterapi" || typeof profile.profile_captured_at !== "string" || !Number.isFinite(Date.parse(profile.profile_captured_at)) || typeof profile.days_since_post !== "number" || !Number.isFinite(profile.days_since_post) || profile.days_since_post < 0) return null;
  return profile.days_since_post;
};
var projectBandRange = (weight, tier) => {
  if (tier === "none") return { minScore: 0, maxScore: 0 };
  if (tier === "adverse") return { minScore: 0, maxScore: Math.floor(weight * 0.39) };
  if (tier === "emerging") return { minScore: Math.ceil(weight * 0.4), maxScore: Math.floor(weight * 0.69) };
  if (tier === "solid") return { minScore: Math.ceil(weight * 0.7), maxScore: Math.floor(weight * 0.84) };
  return { minScore: Math.ceil(weight * 0.85), maxScore: weight };
};
function deriveProjectStrengthBands(evidenceJson, axisCatalog2) {
  const projectAxes = axisCatalog2.filter(({ role }) => role === "PROJECT");
  if (projectAxes.length === 0) return {};
  let packet;
  try {
    const parsed = JSON.parse(evidenceJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    packet = parsed;
  } catch {
    return {};
  }
  const records = (value) => Array.isArray(value) ? value.filter((row) => Boolean(row && typeof row === "object" && !Array.isArray(row))) : [];
  const artifactIds = (values) => [...new Set(values.map((row) => typeof row.artifactId === "string" ? row.artifactId : "").filter(Boolean))];
  const basicFacts = records(packet.basicFacts);
  const verifiedFacts = (...predicates) => basicFacts.filter((fact) => predicates.includes(String(fact.predicate ?? "").toLowerCase()) && fact.artifact_verified === true && (fact.status === "verified" || fact.status === "corroborated"));
  const factText = (facts) => facts.map((fact) => `${String(fact.value ?? "")} ${String(fact.claim ?? "")}`).join(" ");
  const team = records(packet.team).filter((member) => member.artifact_verified === true && member.evidence_origin !== "model_lead");
  const leaders = team.filter((member) => PROJECT_LEADER_TEAM_ROLE.test(String(member.role ?? "")));
  const leaderNames = new Set(leaders.map((member) => String(member.name ?? "").trim().toLowerCase()).filter(Boolean));
  const profile = packet.profile && typeof packet.profile === "object" && !Array.isArray(packet.profile) ? packet.profile : void 0;
  const sourceArtifacts = records(packet.sourceArtifacts);
  const productPress = sourceArtifacts.filter((artifact) => {
    const text2 = `${String(artifact.title ?? "")} ${String(artifact.excerpt ?? "")}`;
    return artifact.kind === "press" && !MATERIAL_RELATIONSHIP_DENIAL.test(text2) && PROJECT_PRODUCT_PRESS.test(text2);
  });
  const freshProductPress = productPress.filter((artifact) => isFreshPublishedArtifact(artifact));
  const relationshipPress = sourceArtifacts.filter((artifact) => {
    const text2 = `${String(artifact.title ?? "")} ${String(artifact.excerpt ?? "")}`;
    return artifact.kind === "press" && !MATERIAL_RELATIONSHIP_DENIAL.test(text2) && (MATERIAL_RELATIONSHIP_PRESS.test(text2) || MULTI_PARTY_LAUNCH_PRESS.test(String(artifact.title ?? "")));
  });
  const distinctRelationshipKeys = new Set(relationshipPress.map(relationshipStoryKey).filter(Boolean));
  const recentActivity = records(packet.recentActivity);
  const productActivity = recentActivity.filter((row) => PROJECT_PRODUCT_ACTIVITY.test(String(row.text ?? row.value ?? row.claim ?? row.title ?? "")));
  const token = packet.projectToken && typeof packet.projectToken === "object" && !Array.isArray(packet.projectToken) ? packet.projectToken : void 0;
  const verifiedToken = token?.verified === true && (token.verification === "official_x" || token.verification === "official_domain");
  const rank = typeof token?.rank === "number" ? token.rank : Number.POSITIVE_INFINITY;
  const marketCap = typeof token?.marketCapUsd === "number" ? token.marketCapUsd : 0;
  const volume = typeof token?.volume24hUsd === "number" ? token.volume24hUsd : 0;
  const liquidity = typeof token?.liquidityUsd === "number" ? token.liquidityUsd : 0;
  const moderateMarket = verifiedToken && (rank <= 500 || marketCap >= 1e7 || volume >= 25e4 || liquidity >= 1e6);
  const scaleSignals = [rank <= 200, marketCap >= 1e8, volume >= 5e6, liquidity >= 5e6].filter(Boolean).length;
  const tokenProviders = Array.isArray(token?.providers) ? new Set(token.providers.filter((provider) => typeof provider === "string")).size : 0;
  const daysSincePost = trustedProjectProfileDaysSincePost(profile);
  const currentSocialActivity = daysSincePost !== null && daysSincePost < 21;
  const repositoryFacts = verifiedFacts("repository", "repositories");
  const leaderFacts = verifiedFacts("founder", "founders", "executive");
  const productFacts = verifiedFacts("product", "launched", "launch_date");
  const auditFacts = verifiedFacts("audit", "audits");
  const governanceFacts = verifiedFacts("governance");
  const tokenDisclosureFacts = verifiedFacts("tokenomics", "vesting", "treasury");
  const legalFacts = verifiedFacts("legal_entity");
  const officialFacts = verifiedFacts("official_identity");
  const fundingFacts = verifiedFacts("funding");
  const investorFacts = verifiedFacts("investor");
  const tractionFacts = verifiedFacts("traction");
  const protocolTractionFacts = tractionFacts.filter((fact) => {
    const text2 = factText([fact]);
    return PROJECT_PROTOCOL_TRACTION.test(text2) || !TOKEN_MARKET_ONLY_TRACTION.test(text2);
  });
  const referenceCapturedAt = Date.parse(String(profile?.profile_captured_at ?? token?.capturedAt ?? ""));
  const currentProtocolTractionFacts = Number.isFinite(referenceCapturedAt) ? protocolTractionFacts.filter((fact) => hasFreshDatedMetric(fact, referenceCapturedAt)) : [];
  const currentActivity = currentSocialActivity || freshProductPress.length > 0;
  const advisorTeam = team.filter((member) => {
    const role = String(member.role ?? "");
    return PROJECT_BACKING_TEAM_ROLE.test(role) && !PROJECT_NON_BACKING_TEAM_ROLE.test(role);
  });
  const productStageText = [
    factText(productFacts),
    ...productActivity.map((row) => String(row.text ?? row.value ?? "")),
    ...productPress.map((row) => `${String(row.title ?? "")} ${String(row.excerpt ?? "")}`)
  ].join(" ");
  const earlyStage = PROJECT_EARLY_STAGE.test(productStageText) && !PROJECT_MATURE_STAGE.test(productStageText);
  const catalog = extractScoringEvidenceCatalog(evidenceJson, axisCatalog2);
  const limitingByAxis = new Map(projectAxes.map(({ axis }) => [axis, catalog.filter((artifact) => isVerifiedCounterArtifact(artifact, axis)).map((artifact) => artifact.artifactId)]));
  const bands = {};
  const setBand = (axis, tier, reasons, anchors, floorTier) => {
    const spec = projectAxes.find((candidate) => candidate.axis === axis);
    if (!spec) return;
    const limiting = limitingByAxis.get(axis) ?? [];
    const effectiveTier = tier === "none" && limiting.length > 0 ? "adverse" : tier;
    const range = projectBandRange(spec.weight, effectiveTier);
    const widenedByUnverified = floorTier !== void 0 && floorTier !== effectiveTier && effectiveTier !== "adverse";
    bands[axis] = {
      tier: effectiveTier,
      ...widenedByUnverified ? { minScore: projectBandRange(spec.weight, floorTier).minScore, maxScore: range.maxScore } : range,
      reasons: [
        ...effectiveTier !== tier ? ["verified score-limiting evidence"] : [],
        ...widenedByUnverified ? ["unverified press widens the ceiling only, never the floor"] : [],
        ...reasons
      ],
      anchorArtifactIds: [.../* @__PURE__ */ new Set([...anchors, ...limiting])]
    };
  };
  const namedLeaderCount = Math.max(leaderNames.size, new Set(leaderFacts.map((fact) => String(fact.value ?? "").trim().toLowerCase()).filter(Boolean)).size);
  const p1Badges = [namedLeaderCount > 0, Boolean(profile?.website) || officialFacts.length > 0, legalFacts.length > 0 || namedLeaderCount >= 2];
  setBand("P1_team_and_identity", p1Badges.filter(Boolean).length >= 3 ? "exceptional" : p1Badges.filter(Boolean).length >= 2 ? "solid" : p1Badges.some(Boolean) ? "emerging" : "none", [
    ...namedLeaderCount ? [`${namedLeaderCount} source-backed leader${namedLeaderCount === 1 ? "" : "s"}`] : [],
    ...Boolean(profile?.website) || officialFacts.length ? ["official identity linkage"] : [],
    ...legalFacts.length || namedLeaderCount >= 2 ? ["operator corroboration"] : []
  ], artifactIds([...leaders, ...leaderFacts, ...officialFacts, ...legalFacts, ...profile ? [profile] : []]));
  const p2Anchors = [...repositoryFacts, ...productFacts, ...auditFacts, ...productPress, ...productActivity];
  const productProof = productFacts.length > 0 || productPress.length > 0 || productActivity.length > 0;
  const verifiedProductProof = productFacts.length > 0 || productActivity.length > 0;
  let p2FloorTier = repositoryFacts.length || verifiedProductProof ? "emerging" : "none";
  if (!earlyStage && repositoryFacts.length > 0 && verifiedProductProof) p2FloorTier = "solid";
  if (!earlyStage && repositoryFacts.length > 0 && verifiedProductProof && auditFacts.length > 0) p2FloorTier = "exceptional";
  let p2Tier = repositoryFacts.length || productProof ? "emerging" : "none";
  if (!earlyStage && repositoryFacts.length > 0 && productProof) p2Tier = "solid";
  if (!earlyStage && repositoryFacts.length > 0 && productProof && (auditFacts.length > 0 || productPress.length >= 2)) p2Tier = "exceptional";
  setBand("P2_product_substance", p2Tier, [
    ...repositoryFacts.length ? ["verified public repository"] : [],
    ...productProof ? ["source-backed product operation"] : [],
    ...earlyStage ? ["explicit early-stage product marker"] : []
  ], artifactIds(p2Anchors), p2FloorTier);
  const tokenDisclosures = [...tokenDisclosureFacts];
  const p3Tier = !verifiedToken ? "none" : scaleSignals >= 2 && tokenDisclosures.length > 0 && auditFacts.length > 0 ? "exceptional" : moderateMarket ? "solid" : "emerging";
  setBand("P3_token_conduct", p3Tier, [
    ...verifiedToken ? ["canonical token verified"] : [],
    ...moderateMarket ? ["measured market activity"] : [],
    ...governanceFacts.length ? ["verified token governance"] : [],
    ...tokenDisclosures.length ? ["verified token economic disclosure"] : [],
    ...auditFacts.length ? ["verified security review"] : []
  ], artifactIds([...token ? [token] : [], ...governanceFacts, ...tokenDisclosures, ...auditFacts]));
  const disclosedTreasury = fundingFacts.some((fact) => /\b(?:disclosed treasury|treasury-funded)\b/i.test(factText([fact])));
  let p4FloorTier = fundingFacts.length || investorFacts.length || advisorTeam.length ? "emerging" : "none";
  if (investorFacts.length > 0 || advisorTeam.length >= 2 || disclosedTreasury) p4FloorTier = "solid";
  let p4Tier = fundingFacts.length || investorFacts.length || advisorTeam.length || relationshipPress.length ? "emerging" : "none";
  if (relationshipPress.length > 0 || investorFacts.length > 0 || advisorTeam.length >= 2 || disclosedTreasury) p4Tier = "solid";
  if (distinctRelationshipKeys.size >= 2) p4Tier = "exceptional";
  setBand("P4_backing_and_partners", p4Tier, [
    ...relationshipPress.length ? [`${distinctRelationshipKeys.size} material relationship source${distinctRelationshipKeys.size === 1 ? "" : "s"}`] : [],
    ...fundingFacts.length ? ["source-backed financing state"] : [],
    ...advisorTeam.length ? [`${advisorTeam.length} named advisor or backer record${advisorTeam.length === 1 ? "" : "s"}`] : []
  ], artifactIds([...relationshipPress, ...fundingFacts, ...investorFacts, ...advisorTeam]), p4FloorTier);
  const verifiedCurrentActivity = currentSocialActivity;
  let p5FloorTier = verifiedCurrentActivity || protocolTractionFacts.length > 0 || verifiedToken ? "emerging" : "none";
  if (verifiedCurrentActivity && (protocolTractionFacts.length > 0 || moderateMarket)) p5FloorTier = "solid";
  if (verifiedCurrentActivity && currentProtocolTractionFacts.length > 0 && scaleSignals >= 2 && tokenProviders >= 2) p5FloorTier = "exceptional";
  let p5Tier = currentActivity || protocolTractionFacts.length > 0 || verifiedToken ? "emerging" : "none";
  if (currentActivity && (protocolTractionFacts.length > 0 || moderateMarket)) p5Tier = "solid";
  if (currentActivity && currentProtocolTractionFacts.length > 0 && scaleSignals >= 2 && tokenProviders >= 2) p5Tier = "exceptional";
  const tvlLongevity = protocolTractionFacts.some((fact) => {
    const text2 = factText([fact]);
    const sinceYear = text2.match(/TVL history since (\d{4})/)?.[1];
    if (!sinceYear) return false;
    const scaleMatch = text2.match(/\$(\d+(?:\.\d+)?)B[^.]*total value locked/i);
    return Number(sinceYear) <= (/* @__PURE__ */ new Date()).getFullYear() - 3 && scaleMatch !== null && Number(scaleMatch[1]) >= 1;
  });
  if (tvlLongevity && currentActivity && p5Tier === "solid") p5Tier = "exceptional";
  if (tvlLongevity && verifiedCurrentActivity && p5FloorTier === "solid") p5FloorTier = "exceptional";
  const severeProjectTokenDrawdown = catalog.some((artifact) => artifact.operation === "findings:ProjectTokenDrawdown" && artifact.counterEligibleAxes?.includes("P5_traction_and_liveness"));
  if (severeProjectTokenDrawdown && p5Tier === "exceptional") p5Tier = "solid";
  if (severeProjectTokenDrawdown && p5FloorTier === "exceptional") p5FloorTier = "solid";
  setBand("P5_traction_and_liveness", p5Tier, [
    ...currentActivity ? ["current operating activity"] : [],
    ...protocolTractionFacts.length ? ["verified protocol usage metric"] : [],
    ...currentProtocolTractionFacts.length ? ["dated current protocol metric"] : [],
    ...tvlLongevity ? ["multi-year billion-scale TVL history"] : [],
    ...moderateMarket ? ["measured token-market corroboration"] : [],
    ...severeProjectTokenDrawdown ? ["severe canonical-token drawdown caps exceptional traction"] : []
  ], artifactIds([
    ...currentSocialActivity && daysSincePost !== null && profile ? [profile] : [],
    ...freshProductPress,
    ...protocolTractionFacts,
    ...token ? [token] : []
  ]), p5FloorTier);
  const disclosureBase = [...legalFacts, ...officialFacts, ...repositoryFacts];
  let p6Tier = disclosureBase.length || governanceFacts.length || auditFacts.length ? "emerging" : "none";
  if ((governanceFacts.length > 0 || auditFacts.length > 0) && disclosureBase.length > 0 || legalFacts.length > 0 && officialFacts.length > 0 && repositoryFacts.length > 0) p6Tier = "solid";
  if (governanceFacts.length && auditFacts.length && (legalFacts.length || repositoryFacts.length)) p6Tier = "exceptional";
  setBand("P6_transparency_integrity", p6Tier, [
    ...legalFacts.length ? ["verified legal operator"] : [],
    ...repositoryFacts.length ? ["public repository disclosure"] : [],
    ...governanceFacts.length ? ["verified governance disclosure"] : [],
    ...auditFacts.length ? ["verified audit disclosure"] : []
  ], artifactIds([...disclosureBase, ...governanceFacts, ...auditFacts]));
  return bands;
}
var compactProfileAuthenticity = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return void 0;
  const row = value;
  return {
    provider: clip(row.provider, 80),
    capturedAt: clip(row.capturedAt, 40),
    imageUrl: clip(row.imageUrl, 420),
    imageContentHash: clip(row.imageContentHash, 64),
    mediaType: clip(row.mediaType, 40),
    classification: clip(row.classification, 80),
    confidence: typeof row.confidence === "number" && Number.isFinite(row.confidence) ? row.confidence : void 0,
    isRealPerson: typeof row.isRealPerson === "boolean" ? row.isRealPerson : void 0,
    flag: typeof row.flag === "boolean" ? row.flag : void 0,
    tells: Array.isArray(row.tells) ? row.tells.slice(0, 8).map((tell) => clip(tell, 180)).filter(Boolean) : [],
    note: clip(row.note, 420)
  };
};
var compactTrustGraphPredicate = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return void 0;
  const row = value;
  const edgeTypes = (candidate) => Array.isArray(candidate) ? candidate.slice(0, 12).map((item) => clip(item, 80)).filter(Boolean) : [];
  return {
    tie_key: clip(row.tie_key, 240),
    tie_type: clip(row.tie_type, 80),
    tie_strength: clip(row.tie_strength, 20),
    subject_edge_types: edgeTypes(row.subject_edge_types),
    other_edge_types: edgeTypes(row.other_edge_types),
    other_report_version_id: clip(row.other_report_version_id, 64),
    other_attestation: clip(row.other_attestation, 40),
    other_completeness: clip(row.other_completeness, 20),
    other_verdict: clip(row.other_verdict, 40)
  };
};
var compactFindingScope = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return void 0;
  const row = value;
  return {
    scope: clip(row.scope, 32),
    target_entity_key: clip(row.target_entity_key, 180),
    target_entity_type: clip(row.target_entity_type, 32),
    relationship_to_subject: clip(row.relationship_to_subject, 32),
    relationship_label: clip(row.relationship_label, 180)
  };
};
var compactTrustGraphScreen = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return void 0;
  const row = value;
  const connections = Array.isArray(row.connections) ? row.connections.slice(0, 8).map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return void 0;
    const connection = candidate;
    const ties = Array.isArray(connection.ties) ? connection.ties.slice(0, 4).map((candidateTie) => {
      if (!candidateTie || typeof candidateTie !== "object" || Array.isArray(candidateTie)) return void 0;
      const tie = candidateTie;
      const edges = (candidateEdges) => Array.isArray(candidateEdges) ? candidateEdges.slice(0, 8).map((item) => clip(item, 60)).filter(Boolean) : [];
      return {
        key: clip(tie.key, 180),
        label: clip(tie.label, 180),
        type: clip(tie.type, 80),
        strength: clip(tie.strength, 20),
        subjectEdgeTypes: edges(tie.subjectEdgeTypes),
        otherEdgeTypes: edges(tie.otherEdgeTypes)
      };
    }).filter(Boolean) : [];
    return {
      other: clip(connection.other, 180),
      otherReportVersionId: clip(connection.otherReportVersionId, 64),
      otherAttestation: clip(connection.otherAttestation, 40),
      otherCompleteness: clip(connection.otherCompleteness, 20),
      otherVerdict: clip(connection.otherVerdict, 40),
      qualified: typeof connection.qualified === "boolean" ? connection.qualified : void 0,
      direct: typeof connection.direct === "boolean" ? connection.direct : void 0,
      ties
    };
  }).filter(Boolean) : [];
  return {
    provider: clip(row.provider, 80),
    capturedAt: clip(row.capturedAt, 40),
    status: clip(row.status, 20),
    contributionCount: typeof row.contributionCount === "number" && Number.isFinite(row.contributionCount) ? row.contributionCount : void 0,
    qualifiedContributionCount: typeof row.qualifiedContributionCount === "number" && Number.isFinite(row.qualifiedContributionCount) ? row.qualifiedContributionCount : void 0,
    sourceContentHash: clip(row.sourceContentHash, 64),
    severity: clip(row.severity, 20),
    line: clip(row.line, 500),
    connections
  };
};
var compactFinding = (value) => {
  if (!value || typeof value !== "object") return null;
  const f = value;
  return {
    finding_type: clip(f.finding_type, 80),
    claim: clip(f.claim, 420),
    source_url: clip(f.source_url, 420),
    source_date: clip(f.source_date, 40),
    source_author: clip(f.source_author, 100),
    verification_status: clip(f.verification_status, 32),
    independent_source_count: typeof f.independent_source_count === "number" && Number.isFinite(f.independent_source_count) ? f.independent_source_count : void 0,
    polarity: typeof f.polarity === "number" && Number.isFinite(f.polarity) ? f.polarity : void 0,
    evidence_origin: clip(f.evidence_origin, 32),
    artifact_verified: typeof f.artifact_verified === "boolean" ? f.artifact_verified : void 0,
    content_hash: clip(f.content_hash, 64),
    trust_graph: compactTrustGraphPredicate(f.trust_graph),
    finding_scope: compactFindingScope(f.finding_scope)
  };
};
var SECTION_AXIS_ELIGIBILITY = {
  profile: [
    "F1_identity_verifiability",
    "F5_reputation_integrity",
    "P1_team_and_identity",
    "K1_identity_roster",
    "K3_disclosure_deletion",
    "I1_identity_legitimacy",
    "AG1_identity_legitimacy",
    "AD1_identity_verifiability",
    "ME1_identity",
    "ME2_role_authenticity",
    "ME3_conduct_reputation"
  ],
  // Visual profile-photo triage is a review lead, never identity proof and
  // therefore never eligible to move a score.
  profileAuthenticity: [],
  trustGraphScreen: [
    "F5_reputation_integrity",
    "F6_network_quality",
    "P1_team_and_identity",
    "P4_backing_and_partners",
    "P6_transparency_integrity",
    "K1_identity_roster",
    "K4_onchain_conduct",
    "K5_cabal_fud",
    "I1_identity_legitimacy",
    "I4_testimonial_corroboration",
    "I5_reputation_fud",
    "AG1_identity_legitimacy",
    "AG3_service_integrity",
    "AG4_reputation_fud",
    "AD1_identity_verifiability",
    "AD3_relationship_corroboration",
    "AD4_advisory_conduct",
    "AD5_reputation_fud",
    "ME1_identity",
    "ME3_conduct_reputation"
  ],
  projectToken: [
    "P3_token_conduct",
    "P5_traction_and_liveness"
  ],
  // Findings are routed by exact finding_type below. A section-wide allowlist
  // made unrelated facts (for example, token collapse) eligible for identity.
  findings: [],
  ventures: [
    "F2_track_record",
    "F3_repeat_backing",
    "F4_build_substance",
    "F5_reputation_integrity",
    "F6_network_quality",
    "P2_product_substance",
    "P4_backing_and_partners",
    "P5_traction_and_liveness",
    "AG2_client_outcomes",
    "AD2_advised_outcomes"
  ],
  testimonials: ["F3_repeat_backing", "F6_network_quality", "P4_backing_and_partners", "I4_testimonial_corroboration", "AD3_relationship_corroboration"],
  advised: ["F2_track_record", "F5_reputation_integrity", "AD2_advised_outcomes", "AD3_relationship_corroboration", "AD4_advisory_conduct", "AD5_reputation_fud"],
  promotions: ["F5_reputation_integrity", "P3_token_conduct", "P6_transparency_integrity", "K2_call_performance", "K3_disclosure_deletion", "K4_onchain_conduct", "K5_cabal_fud", "AG3_service_integrity", "AD4_advisory_conduct"],
  wallets: ["F5_reputation_integrity", "P3_token_conduct", "P6_transparency_integrity", "K2_call_performance", "K3_disclosure_deletion", "K4_onchain_conduct", "AD4_advisory_conduct"],
  team: [
    "F1_identity_verifiability",
    "F2_track_record",
    "F4_build_substance",
    "F6_network_quality",
    "P1_team_and_identity",
    "P2_product_substance",
    "P4_backing_and_partners",
    "I1_identity_legitimacy",
    "AG1_identity_legitimacy",
    "AD1_identity_verifiability",
    "ME1_identity",
    "ME2_role_authenticity"
  ],
  notableFollowers: ["F6_network_quality", "P5_traction_and_liveness", "K5_cabal_fud", "I4_testimonial_corroboration", "I5_reputation_fud", "AG4_reputation_fud", "AD3_relationship_corroboration", "AD5_reputation_fud", "ME2_role_authenticity", "ME3_conduct_reputation"],
  recentActivity: [
    "F4_build_substance",
    "F5_reputation_integrity",
    "P2_product_substance",
    "P3_token_conduct",
    "P5_traction_and_liveness",
    "P6_transparency_integrity",
    "K2_call_performance",
    "K3_disclosure_deletion",
    "K5_cabal_fud",
    "I4_testimonial_corroboration",
    "I5_reputation_fud",
    "AG2_client_outcomes",
    "AG3_service_integrity",
    "AG4_reputation_fud",
    "AD2_advised_outcomes",
    "AD3_relationship_corroboration",
    "AD4_advisory_conduct",
    "AD5_reputation_fud",
    "ME2_role_authenticity",
    "ME3_conduct_reputation"
  ],
  // Source artifacts are routed by kind/provider below. An unknown artifact is
  // intentionally ineligible; a gap is safer than a citation with no semantic
  // relationship to the axis.
  sourceArtifacts: [],
  clientEngagements: ["F5_reputation_integrity", "AG2_client_outcomes", "AG3_service_integrity", "AG4_reputation_fud"],
  associates: ["F6_network_quality", "P4_backing_and_partners", "K5_cabal_fud", "I5_reputation_fud", "AG4_reputation_fud", "AD5_reputation_fud", "ME3_conduct_reputation"],
  ventureTeams: ["F1_identity_verifiability", "F2_track_record", "F4_build_substance", "F6_network_quality", "P1_team_and_identity", "P2_product_substance", "P4_backing_and_partners", "I1_identity_legitimacy", "AG1_identity_legitimacy", "AD1_identity_verifiability"]
};
var REPUTATION_FINDING_AXES = [
  "F5_reputation_integrity",
  "P6_transparency_integrity",
  "K5_cabal_fud",
  "I5_reputation_fud",
  "AG4_reputation_fud",
  "AD5_reputation_fud",
  "ME3_conduct_reputation"
];
var FINDING_AXIS_ELIGIBILITY = {
  CommunityFUD: REPUTATION_FINDING_AXES,
  // Exact-name screens are triage leads, not proof that the result belongs to
  // the audited subject. Keep them in the investigator packet but outside the
  // frozen scorer packet until a direct-subject event is independently proven.
  LegalCaseNameLead: [],
  SanctionsNameLead: [],
  // A failed official product surface is one product-substance finding. Do not
  // triple-charge the same fetch against liveness and transparency as well.
  SiteNotLive: ["F4_build_substance", "P2_product_substance"],
  TokenCollapse: ["F5_reputation_integrity", "P3_token_conduct", "K2_call_performance", "K4_onchain_conduct"],
  // Price performance limits traction/liveness, not token conduct. Keep this
  // distinct from a promoted-token collapse so the report never implies that
  // market drawdown by itself proves misconduct.
  ProjectTokenDrawdown: ["P5_traction_and_liveness"],
  CadenceDecay: ["F4_build_substance", "P5_traction_and_liveness", "ME3_conduct_reputation"],
  TrustGraphConnection: SECTION_AXIS_ELIGIBILITY.trustGraphScreen,
  AdvisoryRug: ["F5_reputation_integrity", "AD2_advised_outcomes", "AD4_advisory_conduct", "AD5_reputation_fud"],
  DeceptionFinding: [
    "F5_reputation_integrity",
    "P6_transparency_integrity",
    "K3_disclosure_deletion",
    "K5_cabal_fud",
    "I4_testimonial_corroboration",
    "I5_reputation_fud",
    "AG3_service_integrity",
    "AG4_reputation_fud",
    "AD3_relationship_corroboration",
    "AD4_advisory_conduct",
    "AD5_reputation_fud",
    "ME3_conduct_reputation"
  ],
  Exit: ["F2_track_record", "F3_repeat_backing", "F4_build_substance", "I2_portfolio_quality"],
  IPO: ["F2_track_record", "F3_repeat_backing", "F4_build_substance", "I2_portfolio_quality"],
  MeridianExit: ["F2_track_record", "F3_repeat_backing", "F4_build_substance", "I2_portfolio_quality"],
  InvestigatorCallout: [
    ...REPUTATION_FINDING_AXES,
    "K3_disclosure_deletion",
    "K4_onchain_conduct",
    "AG3_service_integrity",
    "AD4_advisory_conduct"
  ]
};
var INVESTIGATOR_TOKEN_CONDUCT = /\b(?:token|vesting|treasury|unlock|supply|liquidity|wash trad(?:e|ing)|market manipulation|on-?chain|wallet|dump(?:ed|ing)?|insider sell(?:ing)?|mint)\b/i;
var CHECK_AXIS_ELIGIBILITY = {
  "identity-resolution": ["F1_identity_verifiability", "P1_team_and_identity", "K1_identity_roster", "I1_identity_legitimacy", "AG1_identity_legitimacy", "AD1_identity_verifiability", "ME1_identity"],
  "profile-photo-authenticity": [],
  "code-footprint-github": ["F4_build_substance", "P2_product_substance", "P5_traction_and_liveness", "ME2_role_authenticity"],
  "identity-continuity": ["F1_identity_verifiability", "F5_reputation_integrity", "P1_team_and_identity", "K1_identity_roster", "K3_disclosure_deletion", "I1_identity_legitimacy", "AG1_identity_legitimacy", "AD1_identity_verifiability", "ME1_identity"],
  "affiliations-associates": ["F6_network_quality", "P4_backing_and_partners", "K5_cabal_fud", "I4_testimonial_corroboration", "AD3_relationship_corroboration", "ME2_role_authenticity"],
  "promoted-token-performance": ["P3_token_conduct", "K2_call_performance", "K3_disclosure_deletion", "K4_onchain_conduct", "K5_cabal_fud"],
  "project-token-identity": ["P3_token_conduct"],
  "project-product-substance": ["P2_product_substance", "P5_traction_and_liveness"],
  "project-team-identity": ["P1_team_and_identity"],
  "project-backing-partners": ["P4_backing_and_partners"],
  "project-traction-liveness": ["P5_traction_and_liveness"],
  "project-transparency": ["P3_token_conduct", "P6_transparency_integrity"],
  "founder-identity-authority": ["F1_identity_verifiability"],
  "founder-company-relationships": ["F2_track_record", "F6_network_quality"],
  "founder-track-record": ["F2_track_record", "F4_build_substance"],
  "founder-control-conflicts": ["F5_reputation_integrity"],
  "founder-legal-regulatory": ["F5_reputation_integrity"],
  "founder-asset-distinction": ["F4_build_substance", "F5_reputation_integrity"],
  "vc-portfolio-track-record": ["I2_portfolio_quality"],
  "news-press": ["F5_reputation_integrity", "P2_product_substance", "P5_traction_and_liveness", "I5_reputation_fud", "AG2_client_outcomes", "AG4_reputation_fud", "AD2_advised_outcomes", "AD5_reputation_fud", "ME3_conduct_reputation"],
  "us-legal-history": ["F5_reputation_integrity", "P6_transparency_integrity", "K5_cabal_fud", "I1_identity_legitimacy", "I5_reputation_fud", "AG1_identity_legitimacy", "AG4_reputation_fud", "AD1_identity_verifiability", "AD5_reputation_fud", "ME3_conduct_reputation"],
  "ofac-sanctions-name": ["F1_identity_verifiability", "F5_reputation_integrity", "P1_team_and_identity", "P6_transparency_integrity", "K1_identity_roster", "K5_cabal_fud", "I1_identity_legitimacy", "I5_reputation_fud", "AG1_identity_legitimacy", "AG4_reputation_fud", "AD1_identity_verifiability", "AD5_reputation_fud", "ME1_identity", "ME3_conduct_reputation"],
  "trust-graph-connections": SECTION_AXIS_ELIGIBILITY.trustGraphScreen
};
var SOURCE_ARTIFACT_AXIS_ELIGIBILITY = {
  profile_photo: SECTION_AXIS_ELIGIBILITY.profileAuthenticity,
  trust_graph: SECTION_AXIS_ELIGIBILITY.trustGraphScreen,
  legal_case: [
    "F1_identity_verifiability",
    "F5_reputation_integrity",
    "P1_team_and_identity",
    "P6_transparency_integrity",
    "K1_identity_roster",
    "K5_cabal_fud",
    "I1_identity_legitimacy",
    "I5_reputation_fud",
    "AG1_identity_legitimacy",
    "AG4_reputation_fud",
    "AD1_identity_verifiability",
    "AD5_reputation_fud",
    "ME1_identity",
    "ME3_conduct_reputation"
  ],
  sanctions_screen: [
    "F1_identity_verifiability",
    "F5_reputation_integrity",
    "P1_team_and_identity",
    "P6_transparency_integrity",
    "K1_identity_roster",
    "K5_cabal_fud",
    "I1_identity_legitimacy",
    "I5_reputation_fud",
    "AG1_identity_legitimacy",
    "AG4_reputation_fud",
    "AD1_identity_verifiability",
    "AD5_reputation_fud",
    "ME1_identity",
    "ME3_conduct_reputation"
  ],
  portfolio_relationship: ["I2_portfolio_quality"],
  fund_scale: ["I3_fund_scale_tier"],
  press: [
    "F2_track_record",
    "F3_repeat_backing",
    "F4_build_substance",
    "F5_reputation_integrity",
    "F6_network_quality",
    "P2_product_substance",
    "P4_backing_and_partners",
    "P5_traction_and_liveness",
    "P6_transparency_integrity",
    "K5_cabal_fud",
    "I5_reputation_fud",
    "AG2_client_outcomes",
    "AG4_reputation_fud",
    "AD2_advised_outcomes",
    "AD5_reputation_fud",
    "ME3_conduct_reputation"
  ]
};
var PROJECT_BASIC_FACT_AXIS_ELIGIBILITY = {
  official_identity: ["P1_team_and_identity", "P6_transparency_integrity"],
  founder: ["P1_team_and_identity"],
  founders: ["P1_team_and_identity"],
  executive: ["P1_team_and_identity"],
  team: ["P1_team_and_identity"],
  founded: ["P1_team_and_identity", "P2_product_substance"],
  launched: ["P2_product_substance", "P5_traction_and_liveness"],
  launch_date: ["P2_product_substance", "P5_traction_and_liveness"],
  product: ["P2_product_substance", "P5_traction_and_liveness"],
  official_token: ["P3_token_conduct"],
  token: ["P3_token_conduct"],
  network: ["P2_product_substance", "P3_token_conduct"],
  legal_entity: ["P1_team_and_identity", "P6_transparency_integrity"],
  funding: ["P4_backing_and_partners"],
  investor: ["P4_backing_and_partners"],
  governance: ["P3_token_conduct", "P6_transparency_integrity"],
  tokenomics: ["P3_token_conduct", "P6_transparency_integrity"],
  vesting: ["P3_token_conduct", "P6_transparency_integrity"],
  treasury: ["P3_token_conduct", "P6_transparency_integrity"],
  audit: ["P2_product_substance", "P3_token_conduct", "P6_transparency_integrity"],
  audits: ["P2_product_substance", "P3_token_conduct", "P6_transparency_integrity"],
  repository: ["P2_product_substance", "P5_traction_and_liveness", "P6_transparency_integrity"],
  repositories: ["P2_product_substance", "P5_traction_and_liveness", "P6_transparency_integrity"],
  traction: ["P5_traction_and_liveness"],
  legal_regulatory_event: ["P6_transparency_integrity"]
};
var FOUNDER_BASIC_FACT_AXIS_ELIGIBILITY = {
  official_identity: ["F1_identity_verifiability"],
  current_role: ["F1_identity_verifiability"],
  executive: ["F1_identity_verifiability"],
  education: ["F1_identity_verifiability"],
  founder: ["F2_track_record"],
  founders: ["F2_track_record"],
  prior_role: ["F2_track_record"],
  founded: ["F2_track_record"],
  launched: ["F2_track_record", "F4_build_substance"],
  launch_date: ["F2_track_record", "F4_build_substance"],
  product: ["F2_track_record", "F4_build_substance"],
  exit: ["F2_track_record"],
  track_record: ["F2_track_record"],
  repository: ["F4_build_substance"],
  repositories: ["F4_build_substance"],
  audit: ["F4_build_substance"],
  audits: ["F4_build_substance"],
  traction: ["F2_track_record"],
  // One round or named backer is network evidence, not proof of repeat
  // backing. F3 remains reserved for deterministic multi-round/venture
  // aggregation elsewhere in the frozen evidence catalog.
  investor: ["F6_network_quality"],
  backer: ["F6_network_quality"],
  network: ["F6_network_quality"],
  governance: ["F5_reputation_integrity"],
  control: ["F5_reputation_integrity"],
  conflict_of_interest: ["F5_reputation_integrity"],
  legal_regulatory_event: ["F5_reputation_integrity"]
};
var INVESTOR_BASIC_FACT_AXIS_ELIGIBILITY = {
  official_identity: ["I1_identity_legitimacy"],
  current_role: ["I1_identity_legitimacy"],
  executive: ["I1_identity_legitimacy"],
  education: ["I1_identity_legitimacy"],
  legal_entity: ["I1_identity_legitimacy"],
  governance: ["I1_identity_legitimacy"],
  control: ["I1_identity_legitimacy"],
  prior_role: ["I2_portfolio_quality"],
  founder: ["I2_portfolio_quality"],
  founders: ["I2_portfolio_quality"],
  founded: ["I2_portfolio_quality"],
  product: ["I2_portfolio_quality"],
  exit: ["I2_portfolio_quality"],
  track_record: ["I2_portfolio_quality"],
  funding: ["I2_portfolio_quality"],
  investor: ["I2_portfolio_quality"],
  traction: ["I2_portfolio_quality"],
  conflict_of_interest: ["I5_reputation_fud"],
  legal_regulatory_event: ["I5_reputation_fud"]
};
var OTHER_ROLE_BASIC_FACT_AXIS_ELIGIBILITY = {
  legal_regulatory_event: [
    "K5_cabal_fud",
    "AG4_reputation_fud",
    "AD5_reputation_fud",
    "ME3_conduct_reputation"
  ]
};
var mergeAxisEligibility = (...maps) => {
  const merged = {};
  for (const map of maps) {
    for (const [predicate, axes] of Object.entries(map)) {
      merged[predicate] = [.../* @__PURE__ */ new Set([...merged[predicate] ?? [], ...axes])];
    }
  }
  return merged;
};
var BASIC_FACT_AXIS_ELIGIBILITY = mergeAxisEligibility(
  PROJECT_BASIC_FACT_AXIS_ELIGIBILITY,
  FOUNDER_BASIC_FACT_AXIS_ELIGIBILITY,
  INVESTOR_BASIC_FACT_AXIS_ELIGIBILITY,
  OTHER_ROLE_BASIC_FACT_AXIS_ELIGIBILITY
);
var PROJECT_BACKING_TEAM_ROLE = /\b(?:advisor|adviser|backer|investor)\b/i;
var PROJECT_NON_BACKING_TEAM_ROLE = /\binvestor relations?\b/i;
var PROJECT_TOKEN_ACTIVITY = /\b(?:tokenomics|vesting|token unlock|unlock schedule|emission(?:s| schedule)?|token supply|circulating supply|total supply|max(?:imum)? supply|treasury|token burn|burn mechanism|liquidity|contract address|token contract|airdrop|staking)\b/i;
var PROJECT_TRANSPARENCY_ACTIVITY = /\b(?:governance|proposal|vote|treasury|audit|security audit|security review|vulnerability|incident|disclosure|transparency|multisig|multi-sig)\b/i;
var SCORING_SUPPORTED_AXES = /* @__PURE__ */ new Set([
  ...Object.values(SECTION_AXIS_ELIGIBILITY).flat(),
  ...Object.values(FINDING_AXIS_ELIGIBILITY).flat(),
  ...Object.values(CHECK_AXIS_ELIGIBILITY).flat(),
  ...Object.values(SOURCE_ARTIFACT_AXIS_ELIGIBILITY).flat(),
  ...Object.values(BASIC_FACT_AXIS_ELIGIBILITY).flat()
]);
var sourceArtifactKind = (value) => {
  const kind = typeof value.kind === "string" ? value.kind : "";
  if (SOURCE_ARTIFACT_AXIS_ELIGIBILITY[kind]) return kind;
  const provider = typeof value.provider === "string" ? value.provider : "";
  if (provider === "claude-vision" || provider === "twitterapi") return "profile_photo";
  if (provider === "argus-graph") return "trust_graph";
  if (provider === "courtlistener") return "legal_case";
  if (provider === "opensanctions") return "sanctions_screen";
  if (provider === "google-news") return "press";
  return "";
};
var sourceArtifactEligibleAxes = (value, sourceArtifactPeers = [], subjectHandle, profile) => {
  const kind = sourceArtifactKind(value);
  const match = recordText(value, ["match"], 40)?.toLowerCase();
  if (kind === "legal_case" && match === "candidate") return [];
  if (kind === "sanctions_screen" && (match === "candidate" || match === "exact_name")) return [];
  if (kind === "portfolio_relationship" && value.match !== "relationship_confirmed") return [];
  if (kind === "fund_scale" && !isStrictFundScaleArtifact(value, sourceArtifactPeers, { subjectHandle, profile })) return [];
  const eligible = SOURCE_ARTIFACT_AXIS_ELIGIBILITY[kind] ?? [];
  if (kind === "press") {
    const relationshipText = `${String(value.title ?? "")} ${String(value.excerpt ?? "")}`;
    const speculativeOrDenied = MATERIAL_RELATIONSHIP_DENIAL.test(relationshipText);
    const affirmativeRelationship = !speculativeOrDenied && (MATERIAL_RELATIONSHIP_PRESS.test(relationshipText) || MULTI_PARTY_LAUNCH_PRESS.test(String(value.title ?? "")));
    return eligible.filter((axis) => {
      if (!axis.startsWith("P")) return true;
      if (speculativeOrDenied) return false;
      if (axis === "P2_product_substance") return PROJECT_PRODUCT_PRESS.test(relationshipText);
      if (axis === "P4_backing_and_partners") return affirmativeRelationship;
      if (axis === "P5_traction_and_liveness") {
        return PROJECT_TRACTION_PRESS.test(relationshipText) || PROJECT_PRODUCT_PRESS.test(relationshipText) && isFreshPublishedArtifact(value);
      }
      if (axis === "P6_transparency_integrity") return PROJECT_TRANSPARENCY_PRESS.test(relationshipText);
      return false;
    });
  }
  return eligible;
};
var stableJson = (value) => {
  const normalize2 = (candidate) => {
    if (candidate == null || typeof candidate === "string" || typeof candidate === "boolean") return candidate;
    if (typeof candidate === "number") return Number.isFinite(candidate) ? candidate : null;
    if (Array.isArray(candidate)) return candidate.map(normalize2);
    if (typeof candidate !== "object") return null;
    return Object.fromEntries(
      Object.keys(candidate).sort().filter((key) => candidate[key] !== void 0).map((key) => [key, normalize2(candidate[key])])
    );
  };
  return JSON.stringify(normalize2(value));
};
var evidencePayload = (value) => {
  const base = value && typeof value === "object" && !Array.isArray(value) ? { ...value } : { value };
  delete base.artifactId;
  return base;
};
var eligibleAxesFor = (section, value, axisCatalog2, sourceArtifactPeers = [], subjectHandle, profile) => {
  const checkId = typeof value.checkId === "string" ? value.checkId : typeof value.check_id === "string" ? value.check_id : "";
  const findingType = typeof value.finding_type === "string" ? value.finding_type : "";
  const findingText = section === "findings" ? recordText(value, ["claim", "title", "excerpt", "detail"], 2e3) ?? "" : "";
  const checkStatus = section === "checkOutcomes" ? recordText(value, ["status"], 40)?.toLowerCase() : void 0;
  const candidateOnlyNameScreen = section === "checkOutcomes" && checkStatus === "finding" && (checkId === "us-legal-history" || checkId === "ofac-sanctions-name");
  const basicFactPredicate = section === "basicFacts" ? recordText(value, ["predicate"], 80)?.toLowerCase() ?? "" : "";
  const basicFactAxes = basicFactPredicate === "legal_regulatory_event" && value.attributionScope !== "direct_subject" ? [] : BASIC_FACT_AXIS_ELIGIBILITY[basicFactPredicate] ?? [];
  const findingAxes = section === "findings" ? [
    ...FINDING_AXIS_ELIGIBILITY[findingType] ?? [],
    ...findingType === "InvestigatorCallout" && INVESTIGATOR_TOKEN_CONDUCT.test(findingText) ? ["P3_token_conduct"] : []
  ] : [];
  const profileAxes = section === "profile" && value.profile_collection_state === "resolved" ? [
    ...SECTION_AXIS_ELIGIBILITY.profile,
    ...trustedProjectProfileDaysSincePost(value) !== null ? ["P5_traction_and_liveness"] : []
  ] : [];
  const projectTokenAxes = section === "projectToken" ? [
    "P3_token_conduct",
    ...[value.marketCapUsd, value.volume24hUsd, value.liquidityUsd].some((metric) => typeof metric === "number" && Number.isFinite(metric) && metric > 0) ? ["P5_traction_and_liveness"] : []
  ] : [];
  const teamAxes = section === "team" ? SECTION_AXIS_ELIGIBILITY.team.filter((axis) => axis !== "P2_product_substance" && (axis !== "P4_backing_and_partners" || PROJECT_BACKING_TEAM_ROLE.test(recordText(value, ["role"], 180) ?? "") && !PROJECT_NON_BACKING_TEAM_ROLE.test(recordText(value, ["role"], 180) ?? ""))) : [];
  const recentActivityText = section === "recentActivity" ? recordText(value, ["text", "value", "claim", "title"], 1e3) ?? "" : "";
  const recentActivityAxes = section === "recentActivity" ? SECTION_AXIS_ELIGIBILITY.recentActivity.filter((axis) => (axis !== "P3_token_conduct" || PROJECT_TOKEN_ACTIVITY.test(recentActivityText)) && (axis !== "P6_transparency_integrity" || PROJECT_TRANSPARENCY_ACTIVITY.test(recentActivityText))) : [];
  const eligible = section === "profile" ? profileAxes : section === "projectToken" ? projectTokenAxes : section === "team" ? teamAxes : section === "recentActivity" ? recentActivityAxes : section === "findings" ? findingAxes : section === "checkOutcomes" && checkId ? candidateOnlyNameScreen ? [] : CHECK_AXIS_ELIGIBILITY[checkId] ?? [] : section === "basicFacts" ? basicFactAxes : section === "sourceArtifacts" ? sourceArtifactEligibleAxes(value, sourceArtifactPeers, subjectHandle, profile) : SECTION_AXIS_ELIGIBILITY[section] ?? [];
  const allowed = new Set(eligible);
  return [...new Set(axisCatalog2.filter((axis) => allowed.has(axis.axis)).map((axis) => axis.axis))];
};
var recordText = (record2, keys, max) => {
  for (const key of keys) {
    const value = record2[key];
    if (typeof value === "string" && value.trim()) return clip(value.trim(), max);
  }
  return void 0;
};
var ARTIFACT_SENSITIVE_URL_PARAM = /^(?:(?:x[-_]?(?:amz|goog)|x[-_](?:oss|cos))[-_].+|x[-_]ms[-_](?:signature|token|credential)|access[_-]?token|api[_-]?key|key|token|signature|sig|auth|credential|credentials|security[_-]?token|session[_-]?token|awsaccesskeyid|googleaccessid|key[_-]?pair[_-]?id|policy|cf[_-]?access[_-]?token)$/i;
var safeArtifactSourceUrl = (value) => {
  if (!value) return void 0;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:" || url.username || url.password || !url.hostname) {
      return void 0;
    }
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (ARTIFACT_SENSITIVE_URL_PARAM.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return void 0;
  }
};
var ARTIFACT_URL_FIELDS = /* @__PURE__ */ new Set([
  "sourceUrl",
  "source_url",
  "evidence_url",
  "url",
  "linkedin",
  "link",
  "href",
  "citation",
  "link_evidence_url",
  "attributionSourceUrl",
  "investorDomainSourceUrl",
  "investorDomainProfileWebsite"
]);
var sanitizeArtifactUrls = (value, depth = 0) => {
  if (value == null || typeof value !== "object" || depth > 4) return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeArtifactUrls(item, depth + 1));
  const sourceRecord = value;
  const sanitized = {};
  for (const [key, item] of Object.entries(sourceRecord)) {
    if (ARTIFACT_URL_FIELDS.has(key) && typeof item === "string") {
      if (key === "attributionSourceUrl" || key === "investorDomainSourceUrl" || key === "investorDomainProfileWebsite" || sourceRecord.kind === "fund_scale" && (key === "sourceUrl" || key === "source_url")) {
        try {
          if ([...new URL(item).searchParams.keys()].some((param) => ARTIFACT_SENSITIVE_URL_PARAM.test(param))) continue;
        } catch {
          continue;
        }
      }
      const safe = safeArtifactSourceUrl(item);
      if (safe) sanitized[key] = safe;
      continue;
    }
    sanitized[key] = sanitizeArtifactUrls(item, depth + 1);
  }
  return sanitized;
};
var verificationFor = (section, record2, sourceArtifactPeers = [], subjectHandle, profile) => {
  if (section === "axisGaps") return "unavailable";
  if (section === "checkOutcomes") {
    const status = recordText(record2, ["status"], 40)?.toLowerCase();
    if (status === "confirmed" || status === "finding") return "verified";
    if (status === "checked-empty") return "checked_empty";
    if (status === "unavailable" || status === "unknown" || status === "stale" || status === "not-applicable") return "unavailable";
  }
  if (section === "findings") {
    const status = recordText(record2, ["verification_status"], 40)?.toLowerCase();
    if (status === "verified" && record2.artifact_verified === true) return "verified";
    if (status === "reported") return "reported";
  }
  if (section === "sourceArtifacts") {
    const match = recordText(record2, ["match"], 40);
    const kind = recordText(record2, ["kind"], 80);
    if (kind === "portfolio_relationship") {
      if (match === "relationship_confirmed") return "verified";
      if (match === "candidate") return "reported";
      return "unavailable";
    }
    if (kind === "fund_scale") {
      return isStrictFundScaleArtifact(record2, sourceArtifactPeers, { subjectHandle, profile }) ? "verified" : "unavailable";
    }
    if (kind === "trust_graph") {
      if (record2.coverageState === "unavailable" || match === "observed") return "unavailable";
      if (match === "screened_clear" || match === "no_match") return "checked_empty";
      const contentHash = recordText(record2, ["contentHash"], 64);
      const sourceContentHash = recordText(record2, ["sourceContentHash"], 64);
      if (match === "risk_signal" && /^[a-f0-9]{64}$/i.test(contentHash ?? "") && /^[a-f0-9]{64}$/i.test(sourceContentHash ?? "")) {
        return "verified";
      }
      return "unavailable";
    }
    if (match === "no_match" || match === "screened_clear") return "checked_empty";
    if (match === "candidate") return "reported";
  }
  if (section === "trustGraphScreen") {
    if (record2.status === "incomplete") return "unavailable";
    const connections = Array.isArray(record2.connections) ? record2.connections : [];
    const qualifiedConnections = connections.filter((candidate) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
      const connection = candidate;
      return connection.qualified === true && Array.isArray(connection.ties) && connection.ties.length > 0;
    });
    if (record2.status === "clear" && qualifiedConnections.length === 0) return "checked_empty";
    if (qualifiedConnections.length > 0) return "verified";
    return "unavailable";
  }
  if (section === "projectToken") {
    return record2.verified === true && (record2.verification === "official_x" || record2.verification === "official_domain") ? "verified" : "unavailable";
  }
  if (section === "basicFacts") {
    const status = recordText(record2, ["status"], 40)?.toLowerCase();
    return record2.artifact_verified === true && (status === "verified" || status === "corroborated") ? "verified" : status === "lead" ? "reported" : "unavailable";
  }
  return "observed";
};
var counterEligibleAxesFor = (section, record2, verification, eligibleAxes) => {
  if (verification !== "verified") return [];
  if (section === "findings" && typeof record2.polarity === "number" && record2.polarity < 0) return [...eligibleAxes];
  if (section === "sourceArtifacts" && record2.match === "risk_signal") return [...eligibleAxes];
  if (section === "trustGraphScreen" && (record2.severity === "caution" || record2.severity === "avoid")) return [...eligibleAxes];
  return [];
};
var DIRECT_SECTIONS = /* @__PURE__ */ new Set(["profile", "profileAuthenticity", "projectToken", "findings", "wallets", "promotions", "recentActivity"]);
var providerFor = (section, payload) => {
  if (section === "basicFacts" && Array.isArray(payload.sources)) {
    const source2 = payload.sources.find((value) => value && typeof value === "object" && !Array.isArray(value));
    const sourceProvider = source2 ? recordText(source2, ["provider"], 100) : void 0;
    if (sourceProvider) return sourceProvider;
  }
  const declared = recordText(payload, ["provider"], 100);
  if (declared) return declared;
  if (section === "profile") {
    const profileProvider = recordText(payload, ["profile_provider"], 100);
    if (profileProvider) return profileProvider;
  }
  if (section === "projectToken") {
    const observed = Array.isArray(payload.providers) ? payload.providers.filter((value) => value === "coingecko" || value === "dexscreener" || value === "geckoterminal") : [];
    return observed.length ? [...new Set(observed)].join("/") : "coingecko";
  }
  const attributed = recordText(payload, ["source_author", "source"], 100);
  if (attributed) return attributed;
  const sourceUrl = safeArtifactSourceUrl(
    recordText(payload, ["sourceUrl", "source_url", "evidence_url", "link_evidence_url", "url"], 420)
  );
  if (sourceUrl) {
    try {
      return new URL(sourceUrl).hostname.replace(/^www\./i, "");
    } catch {
    }
  }
  return section === "axisGaps" ? "argus" : "source-unspecified";
};
var makeAxisArtifact = (section, value, axisCatalog2, eligibleOverride, sourceArtifactPeers = [], subjectHandle, profile) => {
  const payload = sanitizeArtifactUrls(evidencePayload(value));
  const contentHash = createHash("sha256").update(stableJson({ section, payload })).digest("hex");
  const artifactId = `art_v1_${contentHash}`;
  const eligibleAxes = eligibleOverride ?? eligibleAxesFor(section, payload, axisCatalog2, sourceArtifactPeers, subjectHandle, profile);
  const provider = providerFor(section, payload);
  const basicFactSource = section === "basicFacts" && Array.isArray(payload.sources) ? payload.sources.find((value2) => value2 && typeof value2 === "object" && !Array.isArray(value2)) : void 0;
  const operationKey = section === "basicFacts" ? recordText(payload, ["predicate"], 100) : recordText(payload, ["checkId", "check_id", "finding_type", "kind", "type"], 100);
  const title = recordText(payload, ["title", "label", "claim", "name", "project_name", "handle", "axis", "value", "predicate"], 180) ?? `${section} evidence`;
  const excerpt = (basicFactSource ? recordText(basicFactSource, ["excerpt"], 320) : void 0) ?? recordText(payload, ["excerpt", "note", "rationale", "evidence", "bio", "detail", "text", "value"], 320);
  const sourceUrl = safeArtifactSourceUrl(
    recordText(payload, ["sourceUrl", "source_url", "evidence_url", "url", "linkedin"], 420)
  ) ?? safeArtifactSourceUrl(basicFactSource ? recordText(basicFactSource, ["url", "sourceUrl"], 420) : void 0);
  const capturedAt = recordText(payload, ["capturedAt", "captured_at", "profile_captured_at", "completedAt", "source_date"], 40) ?? (basicFactSource ? recordText(basicFactSource, ["capturedAt", "captured_at"], 40) : void 0);
  const verification = verificationFor(section, payload, sourceArtifactPeers, subjectHandle, profile);
  const counterEligibleAxes = counterEligibleAxesFor(section, payload, verification, eligibleAxes);
  return {
    decorated: { ...payload, artifactId },
    catalog: {
      artifactId,
      kind: "axis_evidence",
      provider,
      operation: section === "axisGaps" ? `coverage_gap:${eligibleAxes[0] ?? "unknown"}` : `${section}:${operationKey ?? "collect"}`,
      section,
      title,
      ...excerpt ? { excerpt } : {},
      ...sourceUrl ? { sourceUrl } : {},
      ...capturedAt ? { capturedAt } : {},
      contentHash,
      eligibleAxes,
      verification,
      ...counterEligibleAxes.length ? { counterEligibleAxes } : {},
      scope: DIRECT_SECTIONS.has(section) ? "direct_subject" : "subject_context"
    }
  };
};
var SCORING_SINGLE_SECTIONS = ["profile", "profileAuthenticity", "trustGraphScreen", "projectToken"];
var SCORING_ARRAY_SECTIONS = [
  "findings",
  "ventures",
  "testimonials",
  "advised",
  "promotions",
  "wallets",
  "team",
  "basicFacts",
  "notableFollowers",
  "recentActivity",
  "sourceArtifacts",
  "checkOutcomes",
  "clientEngagements",
  "associates",
  "ventureTeams"
];
function renderScoringPacket(packet, axisCatalog2) {
  const rendered = { ...packet, schema_version: 5 };
  const packetProfile = packet.profile && typeof packet.profile === "object" && !Array.isArray(packet.profile) ? packet.profile : void 0;
  const subjectHandle = recordText(packetProfile ?? {}, ["handle"], 80);
  const packetCoverage = packet.coverage && typeof packet.coverage === "object" && !Array.isArray(packet.coverage) ? packet.coverage : {};
  const renderedCoverage = Object.fromEntries(
    Object.entries(packetCoverage).map(([section, value]) => [section, { ...value }])
  );
  delete rendered.coverage;
  delete rendered.providerRuns;
  const artifacts = [];
  for (const section of SCORING_SINGLE_SECTIONS) {
    if (packet[section] == null) continue;
    const artifact = makeAxisArtifact(section, packet[section], axisCatalog2);
    if (artifact.catalog.eligibleAxes.length === 0) {
      delete rendered[section];
      continue;
    }
    rendered[section] = artifact.decorated;
    artifacts.push(artifact.catalog);
  }
  for (const section of SCORING_ARRAY_SECTIONS) {
    const values = Array.isArray(packet[section]) ? packet[section] : [];
    const sourceArtifactPeers = section === "sourceArtifacts" ? values.map((value) => sanitizeArtifactUrls(evidencePayload(value))).filter((value) => Boolean(value && typeof value === "object" && !Array.isArray(value))) : [];
    const eligibleValues = values.flatMap((value) => {
      const artifact = makeAxisArtifact(section, value, axisCatalog2, void 0, sourceArtifactPeers, subjectHandle, packetProfile);
      if (artifact.catalog.eligibleAxes.length === 0) return [];
      artifacts.push(artifact.catalog);
      return [artifact.decorated];
    });
    rendered[section] = eligibleValues;
    if (renderedCoverage[section]) renderedCoverage[section].included = eligibleValues.length;
  }
  const axisGaps = axisCatalog2.flatMap((axis) => {
    const hasEligibleEvidence = artifacts.some((artifact2) => artifact2.eligibleAxes.includes(axis.axis));
    if (hasEligibleEvidence) return [];
    const artifact = makeAxisArtifact("axisGaps", {
      axis: axis.axis,
      status: "unavailable",
      note: `No retained scoring artifact is eligible for ${axis.axis}.`
    }, axisCatalog2, [axis.axis]);
    artifacts.push(artifact.catalog);
    return [artifact.decorated];
  });
  rendered.axisGaps = axisGaps;
  rendered.evidenceCatalog = [...new Map(artifacts.map((artifact) => [artifact.artifactId, artifact])).values()];
  return rendered;
}
var isAxisEvidenceRecord = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value;
  return typeof row.artifactId === "string" && ARTIFACT_ID.test(row.artifactId) && row.kind === "axis_evidence" && typeof row.provider === "string" && !!row.provider && typeof row.operation === "string" && !!row.operation && typeof row.section === "string" && !!row.section && typeof row.title === "string" && !!row.title && (row.excerpt === void 0 || typeof row.excerpt === "string") && (row.sourceUrl === void 0 || typeof row.sourceUrl === "string") && (row.capturedAt === void 0 || typeof row.capturedAt === "string") && typeof row.contentHash === "string" && row.contentHash === row.artifactId.slice("art_v1_".length) && Array.isArray(row.eligibleAxes) && row.eligibleAxes.length > 0 && row.eligibleAxes.every((axis) => typeof axis === "string" && !!axis) && new Set(row.eligibleAxes).size === row.eligibleAxes.length && ["verified", "reported", "observed", "checked_empty", "unavailable"].includes(String(row.verification)) && (row.counterEligibleAxes === void 0 || Array.isArray(row.counterEligibleAxes) && row.counterEligibleAxes.length > 0 && row.counterEligibleAxes.every((axis) => typeof axis === "string" && row.eligibleAxes?.includes(axis)) && new Set(row.counterEligibleAxes).size === row.counterEligibleAxes.length) && (row.scope === "direct_subject" || row.scope === "subject_context");
};
function extractScoringEvidenceCatalog(json, axisCatalog2) {
  let packet;
  try {
    const value = JSON.parse(json);
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    packet = value;
  } catch {
    return [];
  }
  if (!Array.isArray(packet.evidenceCatalog) || !packet.evidenceCatalog.every(isAxisEvidenceRecord)) return [];
  if (axisCatalog2 && axisCatalog2.length > 0 && packet.schema_version !== 5) return [];
  const catalog = packet.evidenceCatalog;
  const byId = new Map(catalog.map((record2) => [record2.artifactId, record2]));
  if (byId.size !== catalog.length) return [];
  const strictCatalog = packet.schema_version === 5;
  const requestedAxes = axisCatalog2 && axisCatalog2.length > 0 && new Set(axisCatalog2.map(({ axis }) => axis)).size === axisCatalog2.length ? [...axisCatalog2] : void 0;
  const packetProfile = packet.profile && typeof packet.profile === "object" && !Array.isArray(packet.profile) ? evidencePayload(packet.profile) : void 0;
  const subjectHandle = recordText(packetProfile ?? {}, ["handle"], 80);
  const sourceArtifactPeers = Array.isArray(packet.sourceArtifacts) ? packet.sourceArtifacts.filter((value) => value && typeof value === "object" && !Array.isArray(value)).map((value) => sanitizeArtifactUrls(evidencePayload(value))).filter((value) => Boolean(value && typeof value === "object" && !Array.isArray(value))) : [];
  const represented = /* @__PURE__ */ new Set();
  const inspect = (section, value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const decorated = value;
    if (typeof decorated.artifactId !== "string") return;
    const artifactId = decorated.artifactId;
    const payload = evidencePayload(decorated);
    const contentHash = createHash("sha256").update(stableJson({ section, payload })).digest("hex");
    const catalogRecord = byId.get(artifactId);
    if (artifactId !== `art_v1_${contentHash}` || catalogRecord?.section !== section || catalogRecord.contentHash !== contentHash) return;
    const verification = verificationFor(section, payload, sourceArtifactPeers, subjectHandle, packetProfile);
    if (strictCatalog && catalogRecord.verification !== verification) return;
    const expectedEligibleAxes = requestedAxes ? section === "axisGaps" ? requestedAxes.some(({ axis }) => axis === payload.axis) && typeof payload.axis === "string" ? [payload.axis] : [] : eligibleAxesFor(section, payload, [...requestedAxes], sourceArtifactPeers, subjectHandle, packetProfile) : catalogRecord.eligibleAxes;
    if (strictCatalog && requestedAxes && (expectedEligibleAxes.length !== catalogRecord.eligibleAxes.length || expectedEligibleAxes.some((axis, index) => axis !== catalogRecord.eligibleAxes[index]))) return;
    const expectedCounterAxes = counterEligibleAxesFor(
      section,
      payload,
      verification,
      expectedEligibleAxes
    );
    const actualCounterAxes = catalogRecord.counterEligibleAxes ?? [];
    if ((strictCatalog || catalogRecord.counterEligibleAxes !== void 0) && (expectedCounterAxes.length !== actualCounterAxes.length || expectedCounterAxes.some((axis, index) => axis !== actualCounterAxes[index]))) {
      return;
    }
    represented.add(artifactId);
  };
  for (const section of SCORING_SINGLE_SECTIONS) inspect(section, packet[section]);
  for (const section of [...SCORING_ARRAY_SECTIONS, "axisGaps"]) {
    if (Array.isArray(packet[section])) packet[section].forEach((value) => inspect(section, value));
  }
  return represented.size === catalog.length ? catalog.map((record2) => ({
    ...record2,
    eligibleAxes: [...record2.eligibleAxes],
    ...record2.counterEligibleAxes ? { counterEligibleAxes: [...record2.counterEligibleAxes] } : {}
  })) : [];
}
var pruneTrustGraphPacket = (packet) => {
  const screen = packet.trustGraphScreen;
  if (!screen || typeof screen !== "object" || Array.isArray(screen)) return false;
  const graph = screen;
  const connections = Array.isArray(graph.connections) ? graph.connections : [];
  for (let index = connections.length - 1; index >= 0; index--) {
    const connection = connections[index];
    if (!connection || typeof connection !== "object" || Array.isArray(connection)) continue;
    const ties = connection.ties;
    if (Array.isArray(ties) && ties.length > 1) {
      ties.pop();
      return true;
    }
  }
  if (connections.length > 1) {
    connections.pop();
    return true;
  }
  if (connections.length === 1) {
    connections.pop();
    return true;
  }
  delete packet.trustGraphScreen;
  return true;
};
function serializeAnalystEvidencePacket(input, options) {
  const sectionLimits = {
    ventures: 12,
    testimonials: 12,
    advised: 12,
    promotions: 16,
    wallets: 12,
    team: 16,
    basicFacts: 24,
    notableFollowers: 16,
    recentActivity: 12,
    sourceArtifacts: 24,
    checkOutcomes: 20,
    providerRuns: 24,
    clientEngagements: 16,
    associates: 16,
    ventureTeams: 12
  };
  const findingsRaw = Array.isArray(input.findings) ? input.findings : [];
  const profile = input.profile && typeof input.profile === "object" && !Array.isArray(input.profile) ? input.profile : void 0;
  const normalizeEntityKey = (value) => {
    if (typeof value !== "string") return void 0;
    const handle = value.trim().replace(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\//i, "").replace(/^@/, "");
    return /^[A-Za-z0-9_]{1,30}$/.test(handle) ? `@${handle.toLowerCase()}` : void 0;
  };
  const subjectEntityKey = normalizeEntityKey(profile?.handle);
  const isInvestigativeLead = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const row = value;
    const scope = row.finding_scope && typeof row.finding_scope === "object" && !Array.isArray(row.finding_scope) ? row.finding_scope : void 0;
    if (row.evidence_origin === "model_lead" || row.artifact_verified === false) return true;
    if (!scope) return false;
    if (scope.scope !== "direct_subject" || scope.relationship_to_subject !== "self") return true;
    const targetEntityKey = normalizeEntityKey(scope.target_entity_key);
    return !!subjectEntityKey && targetEntityKey !== subjectEntityKey;
  };
  const hasTrustedFindingProvenance = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const row = value;
    return (row.evidence_origin === "deterministic" || row.evidence_origin === "human_verified") && row.artifact_verified === true;
  };
  const findingPriority = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return 4;
    const row = value;
    if (row.finding_type === "TrustGraphConnection" && row.trust_graph) return 0;
    if (row.verification_status === "Verified" && row.artifact_verified === true) return 1;
    if (typeof row.polarity === "number" && row.polarity < 0) return 2;
    return 3;
  };
  const scoringFindingsRaw = findingsRaw.filter((value) => !isInvestigativeLead(value) && (!options.axisCatalog || hasTrustedFindingProvenance(value)));
  const investigativeLeadsRaw = findingsRaw.filter(isInvestigativeLead);
  const findings = scoringFindingsRaw.map((value, index) => ({ value, index })).sort((a, b) => findingPriority(a.value) - findingPriority(b.value) || a.index - b.index).slice(0, 24).map(({ value }) => compactFinding(value)).filter((f) => !!f);
  const coverage = {
    findings: { available: scoringFindingsRaw.length, included: findings.length }
  };
  const packet = {
    schema_version: 3,
    coverage,
    finding_scope_policy: {
      findings: "Direct subject evidence eligible for scoring, subject to provenance and verification."
    },
    profile: compactScoringProfile(input.profile),
    profileAuthenticity: compactProfileAuthenticity(input.profileAuthenticity),
    trustGraphScreen: compactTrustGraphScreen(input.trustGraphScreen),
    projectToken: input.projectToken && typeof input.projectToken === "object" && !Array.isArray(input.projectToken) ? compactProjectToken(input.projectToken) : void 0,
    // Findings stay ahead of descriptive context in the budget. This prevents a
    // long social corpus from hiding the material facts that govern a verdict.
    findings
  };
  if (options.includeInvestigativeLeads) {
    const investigativeLeads = investigativeLeadsRaw.slice(0, 16).map((value) => compactFinding(value)).filter((f) => !!f);
    coverage.investigative_leads = {
      available: investigativeLeadsRaw.length,
      included: investigativeLeads.length
    };
    packet.finding_scope_policy.investigative_leads = "Discovery/context only. Never attribute these claims to the audited subject or use them to lower subject scores, set the headline, establish a cap, or claim decision readiness.";
    packet.investigative_leads = investigativeLeads;
  }
  for (const [section, limit] of Object.entries(sectionLimits)) {
    const rawSource = Array.isArray(input[section]) ? input[section] : [];
    if (options.axisCatalog && section === "providerRuns") {
      coverage.providerRuns = { available: rawSource.length, included: 0 };
      continue;
    }
    const source2 = options.includeInvestigativeLeads ? rawSource : rawSource.filter((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return true;
      const record2 = item;
      return record2.evidence_origin !== "model_lead" && record2.artifact_verified !== false;
    });
    const selected = section === "sourceArtifacts" ? retainSourceArtifacts(source2, options.axisCatalog ? source2.length : limit) : source2.slice(0, limit);
    const included = selected.map((item) => section === "sourceArtifacts" ? compactSourceArtifact(item) : compactObject(item)).filter((item) => item !== void 0);
    packet[section] = included;
    coverage[section] = { available: source2.length, included: included.length };
  }
  const pruneOrder = [
    "recentActivity",
    "notableFollowers",
    ...options.includeInvestigativeLeads ? ["investigative_leads"] : [],
    "wallets",
    "promotions",
    "advised",
    "testimonials",
    "ventures",
    "providerRuns",
    "associates",
    "clientEngagements",
    "ventureTeams",
    "checkOutcomes",
    "sourceArtifacts",
    "basicFacts",
    "team"
  ];
  const render = () => options.axisCatalog ? renderScoringPacket(packet, options.axisCatalog) : packet;
  const substantiveAxesIn = (rendered) => {
    if (!Array.isArray(rendered.evidenceCatalog)) return /* @__PURE__ */ new Set();
    return new Set(rendered.evidenceCatalog.flatMap((value) => isAxisEvidenceRecord(value) && isSubstantiveArtifact(value) ? value.eligibleAxes : []));
  };
  const initialRenderedPacket = render();
  const requiredSubstantiveAxes = options.axisCatalog ? substantiveAxesIn(initialRenderedPacket) : /* @__PURE__ */ new Set();
  const requiredProjectBandRanges = options.axisCatalog ? Object.fromEntries(Object.entries(deriveProjectStrengthBands(
    JSON.stringify(initialRenderedPacket),
    options.axisCatalog
  )).map(([axis, band2]) => [axis, `${band2.tier}:${band2.minScore}-${band2.maxScore}`])) : {};
  const preservesSubstantiveCoverage = () => {
    if (!options.axisCatalog || requiredSubstantiveAxes.size === 0) return true;
    const retained = substantiveAxesIn(render());
    return [...requiredSubstantiveAxes].every((axis) => retained.has(axis));
  };
  const preservesProjectBandRanges = () => {
    if (!options.axisCatalog || Object.keys(requiredProjectBandRanges).length === 0) return true;
    const retainedBands = deriveProjectStrengthBands(JSON.stringify(render()), options.axisCatalog);
    return Object.entries(requiredProjectBandRanges).every(([axis, required]) => {
      const band2 = retainedBands[axis];
      return band2 && `${band2.tier}:${band2.minScore}-${band2.maxScore}` === required;
    });
  };
  const preservesDecisionSemantics = () => preservesSubstantiveCoverage() && preservesProjectBandRanges();
  const removeOneArrayItem = (section, minimumLength = 0) => {
    const values = Array.isArray(packet[section]) ? packet[section] : [];
    if (values.length <= minimumLength) return false;
    for (let index = values.length - 1; index >= minimumLength; index -= 1) {
      const [removed] = values.splice(index, 1);
      if (preservesDecisionSemantics()) {
        if (coverage[section]) coverage[section].included = values.length;
        return true;
      }
      values.splice(index, 0, removed);
    }
    return false;
  };
  const removeOneFrom = (sections, allowed) => {
    for (const section of sections) {
      if (allowed(section) && removeOneArrayItem(section)) return true;
    }
    return false;
  };
  const pruneTrustGraphPreservingCoverage = () => {
    const previous = packet.trustGraphScreen == null ? void 0 : structuredClone(packet.trustGraphScreen);
    if (!pruneTrustGraphPacket(packet)) return false;
    if (preservesDecisionSemantics()) return true;
    if (previous === void 0) delete packet.trustGraphScreen;
    else packet.trustGraphScreen = previous;
    return false;
  };
  const deleteProfilePreservingCoverage = () => {
    if (packet.profile == null) return false;
    const previous = packet.profile;
    delete packet.profile;
    if (preservesDecisionSemantics()) return true;
    packet.profile = previous;
    return false;
  };
  if (options.axisCatalog) {
    const sourceArtifactLimit = sectionLimits.sourceArtifacts;
    const sourceArtifacts = Array.isArray(packet.sourceArtifacts) ? packet.sourceArtifacts : [];
    while (sourceArtifacts.length > sourceArtifactLimit) {
      if (!removeOneArrayItem("sourceArtifacts")) break;
    }
    if (sourceArtifacts.length > sourceArtifactLimit) {
      return scoringPacketOversizeJson(options.axisCatalog.length, "source_artifact_cap_irreducible");
    }
  }
  let json = JSON.stringify(render());
  const protectedEvidenceSections = /* @__PURE__ */ new Set(["checkOutcomes", "sourceArtifacts", "basicFacts", "team"]);
  while (json.length > ANALYST_EVIDENCE_MAX_CHARS) {
    if (!removeOneFrom(pruneOrder, (section) => !protectedEvidenceSections.has(section))) break;
    json = JSON.stringify(render());
  }
  while (json.length > ANALYST_EVIDENCE_MAX_CHARS && findings.length > 1) {
    if (!removeOneArrayItem("findings", 1)) break;
    json = JSON.stringify(render());
  }
  while (json.length > ANALYST_EVIDENCE_MAX_CHARS && pruneTrustGraphPreservingCoverage()) {
    json = JSON.stringify(render());
  }
  while (json.length > ANALYST_EVIDENCE_MAX_CHARS) {
    if (!removeOneFrom(pruneOrder, (section) => protectedEvidenceSections.has(section))) break;
    json = JSON.stringify(render());
  }
  while (json.length > ANALYST_EVIDENCE_MAX_CHARS && findings.length > 0) {
    if (!removeOneArrayItem("findings")) break;
    json = JSON.stringify(render());
  }
  if (json.length > ANALYST_EVIDENCE_MAX_CHARS && deleteProfilePreservingCoverage()) {
    json = JSON.stringify(render());
  }
  if (json.length > ANALYST_EVIDENCE_MAX_CHARS) {
    if (options.axisCatalog) {
      return scoringPacketOversizeJson(options.axisCatalog.length, "substantive_coverage_irreducible");
    }
    throw new Error(`analyst evidence packet exceeds ${ANALYST_EVIDENCE_MAX_CHARS} characters after structural pruning`);
  }
  return json;
}
function buildScoringEvidencePacket(input, axisCatalog2) {
  return serializeAnalystEvidencePacket(input, { includeInvestigativeLeads: false, axisCatalog: axisCatalog2 });
}
function inspectAnalystScoringPreflight(axisCatalog2, evidenceJson) {
  if (axisCatalog2.length === 0) {
    return {
      state: "no_axes",
      requestedAxisCount: 0,
      evidenceArtifactCount: 0,
      missingSubstantiveAxes: [],
      unsupportedAxes: []
    };
  }
  const axisNames = axisCatalog2.map(({ axis }) => axis);
  if (new Set(axisNames).size !== axisNames.length || axisCatalog2.some((axis) => !axis.axis || !Number.isInteger(axis.weight) || axis.weight < 0)) {
    return {
      state: "invalid_catalog",
      requestedAxisCount: axisCatalog2.length,
      evidenceArtifactCount: 0,
      missingSubstantiveAxes: [],
      unsupportedAxes: []
    };
  }
  const unsupportedAxes = axisNames.filter((axis) => !SCORING_SUPPORTED_AXES.has(axis));
  if (unsupportedAxes.length > 0) {
    return {
      state: "unsupported_axes",
      requestedAxisCount: axisCatalog2.length,
      evidenceArtifactCount: 0,
      missingSubstantiveAxes: [],
      unsupportedAxes
    };
  }
  try {
    const packet = JSON.parse(evidenceJson);
    if (packet && typeof packet === "object" && !Array.isArray(packet) && packet[SCORING_PACKET_STATE_FIELD] === SCORING_PACKET_OVERSIZE) {
      return {
        state: "packet_oversize",
        requestedAxisCount: axisCatalog2.length,
        evidenceArtifactCount: 0,
        missingSubstantiveAxes: [],
        unsupportedAxes: []
      };
    }
  } catch {
  }
  const evidenceCatalog = extractScoringEvidenceCatalog(evidenceJson, axisCatalog2);
  if (!evidenceCatalog.length) {
    return {
      state: "invalid_catalog",
      requestedAxisCount: axisCatalog2.length,
      evidenceArtifactCount: 0,
      missingSubstantiveAxes: [],
      unsupportedAxes: []
    };
  }
  const projectBands = deriveProjectStrengthBands(evidenceJson, axisCatalog2);
  const missingSubstantiveAxes = axisCatalog2.filter((axis) => !evidenceCatalog.some((artifact) => isSubstantiveArtifact(artifact) && artifact.eligibleAxes.includes(axis.axis)) || axis.role === "PROJECT" && projectBands[axis.axis]?.tier === "none").map(({ axis }) => axis);
  return {
    state: missingSubstantiveAxes.length > 0 ? "insufficient_evidence" : "ready",
    requestedAxisCount: axisCatalog2.length,
    evidenceArtifactCount: evidenceCatalog.length,
    missingSubstantiveAxes,
    unsupportedAxes: []
  };
}
async function analyzeSubject(handle, roles, axisCatalog2, evidenceJson, options = {}) {
  const axisNames = axisCatalog2.map(({ axis }) => axis);
  if (!axisCatalog2.length || new Set(axisNames).size !== axisNames.length || axisCatalog2.some((axis) => !axis.axis || !Number.isInteger(axis.weight) || axis.weight < 0)) return null;
  const preflight = inspectAnalystScoringPreflight(axisCatalog2, evidenceJson);
  console.info("[agent-preflight]", JSON.stringify({
    tool: "record_verdict",
    ...preflight
  }));
  if (preflight.state !== "ready") return null;
  const evidenceCatalog = extractScoringEvidenceCatalog(evidenceJson, axisCatalog2);
  const citationAliases = evidenceCatalog.map((artifact, index) => ({
    alias: `e${String(index + 1).padStart(3, "0")}`,
    artifact
  }));
  const substantiveAliasesForAxis = (axis) => citationAliases.filter(({ artifact }) => artifact.eligibleAxes.includes(axis) && isSubstantiveArtifact(artifact)).map(({ alias }) => alias);
  const verifiedScoreLimitingAliasesForAxis = (axis) => citationAliases.filter(({ artifact }) => isVerifiedCounterArtifact(artifact, axis)).map(({ alias }) => alias);
  const preferredCoverageAliasesForAxis = (axis) => citationAliases.filter(({ artifact }) => artifact.eligibleAxes.includes(axis) && !isSubstantiveArtifact(artifact)).sort((a, b) => Number(b.artifact.verification === "unavailable") - Number(a.artifact.verification === "unavailable")).slice(0, 4).map(({ alias }) => alias);
  const formatAliases = (aliases) => aliases.length > 0 ? aliases.join(", ") : "(none)";
  const citationAliasTable = citationAliases.map(({ alias, artifact }) => `${alias} = ${artifact.artifactId}`).join("\n");
  const citationEligibilityTable = axisCatalog2.map(({ axis }) => `${axis} | substantive aliases (choose 1 primary; do not exhaustively copy): ${formatAliases(substantiveAliasesForAxis(axis))} | verified score-limiting aliases (the only counterEvidenceRefs that can justify a PROJECT score below its evidence-strength band): ${formatAliases(verifiedScoreLimitingAliasesForAxis(axis))} | coverageRefs preferred return set (optional; return 0-4 total, never the whole coverage catalog): ${formatAliases(preferredCoverageAliasesForAxis(axis))}`).join("\n");
  const system = "You are ARGUS, a forensic crypto due-diligence analyst. You score a subject on a fixed set of axes from collected evidence only. Be skeptical: a strong story never papers over a disqualifying fact. Score conservatively when evidence is thin. Each axis score must be between 0 and its weight. Write one tight rationale per axis citing the evidence. Never use em dashes.";
  const roleSpecificScoringPolicy = scoringPolicyForAxes(axisCatalog2);
  const projectScoreBands = deriveProjectStrengthBands(evidenceJson, axisCatalog2);
  const projectBandPolicy = axisCatalog2.filter(({ role }) => role === "PROJECT").map(({ axis }) => {
    const band2 = projectScoreBands[axis];
    return band2 ? `${axis}: ${band2.tier} evidence, allowed ${band2.minScore}-${band2.maxScore}` + (band2.tier === "adverse" ? "; cite a verified harmful alias as primary support for the adverse assessment and leave that alias out of counterEvidenceRefs" : "") : `${axis}: no affirmative strength band`;
  }).join("; ");
  const user = `Subject: ${handle}
Held roles: ${roles.join(", ")}

Axes to score (axis | weight | role):
` + axisCatalog2.map((a) => `- ${a.axis} | max ${a.weight} | ${a.role}`).join("\n") + (roleSpecificScoringPolicy ? `

${roleSpecificScoringPolicy}` : "") + (projectBandPolicy ? `

PROJECT EVIDENCE-STRENGTH BANDS FOR THIS FROZEN PACKET: ${projectBandPolicy}. Stay inside each range. Going below a positive axis's minimum requires a distinct severe verified score-limiting alias in counterEvidenceRefs; positive support alone never authorizes a lower score. A listed canonical-token drawdown alias must be cited in P5 counterEvidenceRefs, and its solid-band cap is already reflected in the frozen range, so it does not authorize scoring below that range. No evidence may justify exceeding the maximum. Never duplicate one alias on both sides. For an adverse band, the harmful fact supports the adverse assessment: cite it as primary evidence rather than duplicating it in counter-evidence.` : "") + `

Collected evidence (JSON):
${evidenceJson}

Citation aliases (return these short aliases in the tool call; ARGUS maps them back to the exact immutable artifact IDs):
${citationAliasTable}

Axis citation guidance (the substantive aliases are authoritative, while each coverageRefs preferred return set is intentionally bounded. These are candidate sets, not checklists: never copy every available artifact. Other eligible coverage artifacts remain frozen in the evidence packet and need not be cited. primaryEvidenceRef and additionalEvidenceRefs may use only the substantive aliases. For this call, coverageRefs may use only the preferred return set. counterEvidenceRefs for PROJECT axes may use only the listed verified score-limiting aliases; other roles may use unused substantive aliases):
${citationEligibilityTable}

Score every listed axis, write the composite headline (one sentence on what governs the verdict), and an identity note.

ACTIVITY RULE: weigh posting cadence. profile.days_since_post is how long the account has been silent. For a PROJECT/token, going quiet for weeks (roughly 21+ days) is a real liveness flag (abandoned, winding down, or quiet after a raise) and should temper traction/execution axes; for an individual it is a milder signal. Recent, steady posting is mildly positive, not a free pass.

OBSERVED NETWORK RULE: a non-empty notableFollowers array is direct observed network evidence. You may state that follower coverage is partial, but never claim that no notable followers were found, listed, documented, or present when those rows exist. Name representative observed accounts in the rationale.

IDENTITY RULE: if the evidence has a "team" array of named people tied to the project (especially any with a LinkedIn, or a named founder/CEO/CTO), the project's real-world identity is RESOLVED. A pseudonymous brand/company handle run on behalf of a publicly named team is NORMAL and is NOT an anonymity red flag: do not score identity/backing axes as if the operators were anonymous, and do NOT write a headline that calls the founder identity "unresolved", "unnamed", or "anonymous" when named leaders are present. The same applies to identity notes, axis rationales, and gap lines: a licensed identity-provider miss does not erase first-party founder evidence. Only treat identity as unresolved when the evidence genuinely names no one behind the project.

FOUNDER IDENTITY AND TRACK RECORD RULE: for a FOUNDER report, a verified Basic Fact or founder decision check governs the person's role. Describe that role as verified, not claimed, inferred, self-reported, or unresolved. Follower count, profile biography, posting cadence, notable followers, and X follow relationships may inform F6 network quality only. They never prove identity, founder status, track record, repeat backing, or build substance. A missing personal GitHub profile, People Data Labs miss, or checked-empty exact-name news query is a coverage limitation and cannot erase verified founder, company, product, or outcome evidence. Preserve source-specific entities: being CEO of an operating company does not make the person CEO of a related protocol or DAO.

PUBLIC DILIGENCE GAP RULE: identity gaps must be resolvable through public or consensually supplied professional records. Never request or recommend collecting a government-issued ID, passport, SSN or tax ID, home address, private account credentials, private financial records, or any other non-public personal proof. When public evidence is insufficient, say the public identity or role evidence remains unresolved and name the public source that should be checked next.

PROFILE PHOTO RULE: profileAuthenticity is a visual-integrity triage screen, not identity proof. A real-looking photo never establishes who operates the account, and an AI, stock, celebrity, logo, cartoon, unclear, or missing photo never establishes impersonation by itself. Use it only as a review lead.

FUND SCALE RULE: score I3 only from verified fund_scale artifacts. Keep firm-wide AUM separate from an individual vehicle close, never sum several vehicles into AUM, and treat first_close or at_least values as lower bounds. An affiliated fund's scale is context for that fund and is never the audited person's personal capital. Historical vehicle closes remain fixed facts, while historical or undated AUM must not be presented as current.

INVESTIGATIVE LEAD EXCLUSION: investigative leads are excluded from this scoring packet. Do not infer anything about the subject from their absence. Use all remaining collected evidence according to its provenance and verification state.

FINDING ATTRIBUTION RULE: when comparing or interpreting finding collections, only direct-subject findings may be attributed to the audited subject. A relationship alone is not evidence of participation or responsibility. This restriction applies to finding collections, not to legitimate non-finding evidence: profile, team, wallet, check-outcome, source, and provider evidence may affect scoring when relevant and reliable.

CITATION RULE: return exactly one array row for every requested axis. The axis field must exactly match an ID in the requested axis list and score must be an integer from zero through that axis's listed maximum. primaryEvidenceRef must be one substantive alias eligible for that axis. additionalEvidenceRefs contains zero to seven other substantive aliases, without duplicates. Always return coverageRefs, using an empty array when none apply; it may contain zero to four checked-empty or unavailable aliases eligible for that axis. Gaps must include a material missing-coverage description for every unavailable coverage reference. A checked-empty reference records a completed clear or negative screen; it is not an evidence gap and must not create a gap line by itself. counterEvidenceRefs contains zero to eight substantive aliases that credibly pull against the score. Never repeat an alias or place it on both sides. gaps contains zero to six short descriptions of material unresolved evidence. Write each gap as a plain question an investor would ask, one sentence, without internal vocabulary: never write packet, provider, coverage, collected, artifact, telemetry, or frozen. Within a solid or exceptional band, an item already recorded as a gap must not also push the score toward the band minimum: the band floor prices the gap once. Score conservatively when evidence is thin. providerRuns operational telemetry is excluded from the scoring packet and must never be inferred or cited.

TRUST GRAPH RULE: only qualified connections and structured TrustGraphConnection findings bound to an exact complete server-collected report may influence scoring. Weak or unqualified ties are context only. ARGUS applies any graph cap deterministically after your axis scoring; do not invent or strengthen one.`;
  const tool = {
    name: "record_verdict",
    description: "Record one complete forensic score row for every requested axis, plus a composite headline and identity note. Coverage-only citations belong only in coverageRefs. Unavailable coverage requires a material gap; checked-empty coverage records a completed screen and does not. Coverage never counts as substantive support or counter-evidence. Every declared field must be returned, even when an array is empty. ARGUS deterministically validates the exact axis set, score bounds, and citation eligibility before accepting the result.",
    strict: true,
    input_schema: RECORD_VERDICT_INPUT_SCHEMA
  };
  const firstAttemptTimeoutMs = typeof options.analystDeadlineAt === "number" ? Math.min(ANALYST_SCORING_TIMEOUT_MS, Math.max(0, options.analystDeadlineAt - Date.now())) : ANALYST_SCORING_TIMEOUT_MS;
  if (firstAttemptTimeoutMs < 1e3) {
    console.warn("[agent-runtime]", JSON.stringify({
      tool: "record_verdict",
      state: "scoring_skipped_budget",
      remainingMs: firstAttemptTimeoutMs
    }));
    return null;
  }
  let raw = await structured(
    system,
    user,
    tool,
    6e3,
    firstAttemptTimeoutMs
  );
  let rejectionReason = "unknown";
  let normalizedRaw = normalizeAnalystSupportCounterOverlap(raw, evidenceCatalog, projectScoreBands);
  normalizedRaw = normalizeAnalystCitationEligibility(normalizedRaw, evidenceCatalog);
  if (normalizedRaw !== raw) {
    console.info("[agent] normalized analyst citation placement before strict validation");
  }
  let validated = validateAnalystVerdict(
    normalizedRaw,
    axisCatalog2,
    evidenceCatalog,
    (reason) => {
      rejectionReason = reason;
    },
    { projectScoreBands }
  );
  if (raw && !validated) {
    console.warn(`[agent] rejected incomplete or invalid analyst axis set (${rejectionReason})`);
    if (typeof options.analystDeadlineAt === "number" && Date.now() + ANALYST_REPAIR_TIMEOUT_MS > options.analystDeadlineAt) {
      console.warn("[agent-runtime]", JSON.stringify({
        tool: "record_verdict",
        state: "repair_skipped_budget",
        remainingMs: Math.max(0, options.analystDeadlineAt - Date.now()),
        requiredMs: ANALYST_REPAIR_TIMEOUT_MS
      }));
      return null;
    }
    const rejectedAxis = axisNames.find((axis) => rejectionReason.endsWith(`:${axis}`));
    const coverageLimitMatch = rejectionReason.match(/^coverage-reference-limit-observed-(\d+)-max-4:/);
    const supportCounterOverlap = rejectionReason.startsWith("support-counter-overlap:");
    const outOfBandProjectAxes = rejectionReason.match(/^project-scores-outside-evidence-strength-band:(.+)$/)?.[1]?.split(",").filter((axis) => axisNames.includes(axis)) ?? [];
    const verifiedScoreLimitingRepairAliases = outOfBandProjectAxes.map((axis) => `${axis}: ${formatAliases(verifiedScoreLimitingAliasesForAxis(axis))}`).join("; ");
    const calibratedRepairBands = outOfBandProjectAxes.map((axis) => {
      const band2 = projectScoreBands[axis];
      return `${axis}: ${band2?.minScore}-${band2?.maxScore} (${band2?.tier ?? "none"})`;
    }).join("; ");
    const projectBandRepair = outOfBandProjectAxes.length > 0 ? ` The prior ${outOfBandProjectAxes.join(", ")} score${outOfBandProjectAxes.length === 1 ? " was" : "s were"} outside the evidence-strength band. Recheck every PROJECT axis against the calibration policy. Required bands by axis: ${calibratedRepairBands}. Stay inside the listed range unless a verified score-limiting alias justifies going below the minimum; never exceed the maximum. Verified score-limiting aliases by axis: ${verifiedScoreLimitingRepairAliases}. Missing coverage, unavailable providers, unanswered questions, and positive context belong in coverageRefs, gaps, or support and cannot justify a lower score.` : "";
    let rejectedAxisHint = "";
    if (rejectionReason === "grounded-team-described-as-unresolved") {
      rejectedAxisHint = " The frozen packet contains substantive named-team artifacts. Rewrite the headline, identity note, every axis rationale, and every evidence-gap line to acknowledge the public team. Do not claim there is no, absent, unnamed, unresolved, anonymous, unknown, or undisclosed project founder, operator, executive, leader, or team. Keep a failed licensed-identity-provider lookup separate from the first-party founder evidence; it does not erase the named team.";
    } else if (rejectionReason === "founder-fundamentals-cite-network-only-evidence") {
      rejectedAxisHint = " F2 track record and F3 repeat backing may not cite follower count, profile biography, posting cadence, notable followers, or X follow relationships. Remove that network-only context from those rows. Use it only in F6 network quality, and score F2 or F3 only from source-backed roles, ventures, products, outcomes, financing, investors, or repeat counterparties.";
    } else if (rejectionReason === "grounded-founder-role-described-as-unverified") {
      rejectedAxisHint = " The frozen packet contains verified founder or current-role evidence. Rewrite the headline, identity note, every axis rationale, and every gap line to state the verified relationship directly. Do not call that role claimed, inferred, self-reported, unconfirmed, uncorroborated, unresolved, or unverified. Missing People Data Labs, GitHub, or exact-name news coverage may remain a separate coverage gap but cannot erase the verified role.";
    } else if (rejectionReason === "grounded-founder-track-record-described-as-social-only") {
      rejectedAxisHint = " The frozen packet contains verified founder, product, role, or outcome evidence for F2. Rewrite F2 and the report summary from those source-backed artifacts. Followers, profile biography, posting cadence, and follow relationships may inform F6 only. You may say that additional measurable outcomes remain incomplete, but do not say the track record is inferred from social reach or a claimed role.";
    } else if (rejectionReason === "founder-track-record-described-as-social-only") {
      rejectedAxisHint = " Followers, profile biography, posting cadence, and follow relationships may inform F6 network quality only. They cannot establish F2 track record. If the frozen packet has no source-backed founder, role, product, or outcome artifacts, state that the track record remains unscored and publish the investigation as incomplete rather than inferring it from social reach.";
    } else if (rejectionReason.startsWith("relationship-press-described-as-uncollected")) {
      rejectedAxisHint = " The frozen packet contains press artifacts naming a counterparty relationship that are eligible for P4. Do not write a gap claiming partnership or integration evidence was not collected. You may state that the named integrations are press-reported and not yet first-party confirmed, which is the accurate remaining gap.";
    } else if (rejectionReason === "grounded-notable-followers-described-as-absent") {
      rejectedAxisHint = " The frozen packet contains observed notable-follower artifacts. Rewrite the headline, identity note, every axis rationale, and every evidence-gap line to acknowledge those accounts. You may describe provider coverage as partial, but do not claim that no notable followers were found, listed, documented, present, included, or observed. Name representative observed accounts in the F6 network-quality rationale.";
    } else if (projectBandRepair) {
      rejectedAxisHint = projectBandRepair;
    } else if (rejectedAxis && coverageLimitMatch) {
      rejectedAxisHint = ` The prior ${rejectedAxis} coverageRefs contained ${coverageLimitMatch[1]} aliases; the maximum is 4. Return no more than these four preferred aliases: ${formatAliases(preferredCoverageAliasesForAxis(rejectedAxis))}. Do not append or move omitted coverage aliases into support or counter fields.`;
    } else if (rejectedAxis && supportCounterOverlap) {
      rejectedAxisHint = projectScoreBands[rejectedAxis]?.tier === "adverse" ? ` For adverse ${rejectedAxis}, the verified harmful alias is primary support for the adverse assessment. Keep one of ${formatAliases(verifiedScoreLimitingAliasesForAxis(rejectedAxis))} as primaryEvidenceRef and remove it from counterEvidenceRefs. Leave counterEvidenceRefs empty unless a distinct verified score-limiting alias remains; no alias may appear on both sides.` : ` For ${rejectedAxis}, the same alias appeared in support and counter-evidence. Counter-evidence wins only when it is a verified score-limiting alias: keep that alias only in counterEvidenceRefs, then choose a different unused substantive alias as primaryEvidenceRef from ${formatAliases(substantiveAliasesForAxis(rejectedAxis))}. No alias may appear in both primary/additional support and counter-evidence.`;
    } else if (rejectedAxis) {
      rejectedAxisHint = ` For ${rejectedAxis}, choose exactly one primary from the substantive aliases ${formatAliases(substantiveAliasesForAxis(rejectedAxis))}. Assign each other substantive alias to at most one array. Return coverageRefs as zero to four distinct values chosen only from ${formatAliases(preferredCoverageAliasesForAxis(rejectedAxis))}; [] is valid and you must not exhaustively copy coverage artifacts.`;
    }
    const repairUser = `${user}

REPAIR REQUIRED: the prior record_verdict tool payload was rejected by deterministic validation with reason "${rejectionReason}". Make one fresh record_verdict call. Recheck the exact axis set, per-axis score bounds, citation eligibility, duplicate aliases, support/counter overlap, and the array limits (seven additional support, eight counter, four coverage, and six gaps), plus the requirement that any returned coverageRefs have a material gap description. Do not invent evidence or fill a missing fact.${rejectedAxisHint}`;
    raw = await structured(
      system,
      repairUser,
      tool,
      6e3,
      ANALYST_REPAIR_TIMEOUT_MS
    );
    rejectionReason = "unknown";
    normalizedRaw = normalizeAnalystSupportCounterOverlap(raw, evidenceCatalog, projectScoreBands);
    normalizedRaw = normalizeAnalystCitationEligibility(normalizedRaw, evidenceCatalog);
    if (normalizedRaw !== raw) {
      console.info("[agent] normalized repaired citation placement before strict validation");
    }
    validated = validateAnalystVerdict(
      normalizedRaw,
      axisCatalog2,
      evidenceCatalog,
      (reason) => {
        rejectionReason = reason;
      },
      { projectScoreBands }
    );
    if (raw && !validated) {
      console.warn(`[agent] rejected analyst repair axis set (${rejectionReason})`);
    }
  }
  return validated;
}

// src/lib/scanChecklist.ts
function decisionCriticalChecks(checks) {
  const hasExplicitCriticality = checks.some((check) => check.decisionCritical !== void 0);
  return hasExplicitCriticality ? checks.filter((check) => check.decisionCritical === true) : checks;
}
var SUCCESSFUL = /* @__PURE__ */ new Set(["confirmed", "finding", "checked-empty"]);
var NEVER_WAIVE_CHECK_IDS = /* @__PURE__ */ new Set([
  "identity-resolution",
  "ofac-sanctions-name",
  "trust-graph-connections",
  // An unresolved token/security candidacy is a capital-risk unknown (the core
  // scam vector), never an enrichment gap.
  "founder-asset-distinction"
]);
var CLEARANCE_COVERAGE_FLOOR_PERCENT = 75;
function clearanceCoverage(checks) {
  const governing = decisionCriticalChecks(checks);
  const applicableRows = governing.filter((check) => check.status !== "not-applicable");
  const recordedRows = applicableRows.filter((check) => SUCCESSFUL.has(check.status));
  const hasStableIds = applicableRows.some((check) => typeof check.checkId === "string" && check.checkId);
  const openNeverWaive = hasStableIds ? applicableRows.filter((check) => check.checkId && NEVER_WAIVE_CHECK_IDS.has(check.checkId) && !SUCCESSFUL.has(check.status)).map((check) => check.checkId) : [];
  const applicable = applicableRows.length;
  const recorded = recordedRows.length;
  const recordedPercent = applicable > 0 ? Math.floor(recorded / applicable * 100) : 0;
  const sufficient = applicable > 0 && (hasStableIds ? openNeverWaive.length === 0 && recordedPercent >= CLEARANCE_COVERAGE_FLOOR_PERCENT : recorded === applicable);
  return { applicable, recorded, openNeverWaive, recordedPercent, sufficient };
}
var outcomeNotRecorded = "completion outcome not recorded";
function personChecks(opts) {
  const { identityConfidence, realName, roles, hasAssociates } = opts;
  const resolved = identityConfidence === "Confirmed" || identityConfidence === "Probable";
  const checks = [];
  checks.push(
    identityConfidence === "Confirmed" ? { label: "Identity resolution", status: "confirmed", note: "confirmed confidence" } : identityConfidence ? { label: "Identity resolution", status: "finding", note: `${identityConfidence.toLowerCase()} confidence` } : { label: "Identity resolution", status: "unknown", note: outcomeNotRecorded }
  );
  checks.push({ label: "Profile-photo authenticity", status: "unknown", note: `AI / stock / celebrity / logo; ${outcomeNotRecorded}` });
  checks.push({ label: "Code footprint (GitHub)", status: "unknown", note: `resolved from handle / name / bio; ${outcomeNotRecorded}` });
  checks.push({ label: "Identity continuity", status: "unknown", note: `prior handles, cross-platform accounts; ${outcomeNotRecorded}` });
  checks.push(hasAssociates ? { label: "Affiliations & associates", status: "confirmed", note: "associate records present in the dossier" } : { label: "Affiliations & associates", status: "unknown", note: "no collection outcome recorded; an empty dossier is not a confirmed clean result" });
  checks.push(roles.includes("KOL") ? { label: "Promoted-token performance", status: "unknown", note: `eligible by role; ${outcomeNotRecorded}` } : { label: "Promoted-token performance", status: "not-applicable", note: "not a KOL" });
  checks.push(roles.includes("INVESTOR") ? { label: "Portfolio track record", status: "unknown", note: `eligible by role; ${outcomeNotRecorded}` } : { label: "Portfolio track record", status: "not-applicable", note: "not a fund/investor" });
  const projectChecks = [
    { label: "Canonical project token", status: "unknown", note: outcomeNotRecorded },
    { label: "Product and website substance", status: "unknown", note: outcomeNotRecorded },
    { label: "Project team identity", status: "unknown", note: outcomeNotRecorded },
    { label: "Backing and partners", status: "unknown", note: outcomeNotRecorded },
    { label: "Traction and liveness", status: "unknown", note: outcomeNotRecorded },
    { label: "Transparency and disclosures", status: "unknown", note: outcomeNotRecorded }
  ];
  checks.push(...projectChecks.map((check) => roles.includes("PROJECT") ? check : { ...check, status: "not-applicable", note: "not a project account" }));
  checks.push({ label: "News & press", status: "unknown", note: outcomeNotRecorded });
  checks.push(resolved && realName ? { label: "US legal history", status: "unknown", note: `eligible by resolved name; ${outcomeNotRecorded}` } : { label: "US legal history", status: "not-applicable", note: "needs a resolved real name" });
  checks.push(resolved && realName ? { label: "OFAC sanctions (name)", status: "unknown", note: `eligible by resolved name; ${outcomeNotRecorded}` } : { label: "OFAC sanctions (name)", status: "not-applicable", note: "needs a resolved real name" });
  checks.push({ label: "Trust-graph connections", status: "unknown", note: `ties to other audited subjects; ${outcomeNotRecorded}` });
  return checks;
}

// server/checks.ts
var CHECKS = [
  {
    id: "identity-resolution",
    label: "Identity resolution",
    defaultNote: "no completed server-side identity resolution was recorded",
    criticalFor: ["KOL", "INVESTOR", "ADVISOR", "AGENCY", "MEMBER"]
  },
  { id: "profile-photo-authenticity", label: "Profile-photo integrity", defaultNote: "server collector did not run a profile-photo integrity screen", requiresPersonRole: true },
  { id: "code-footprint-github", label: "Code footprint (GitHub)", defaultNote: "no completed GitHub resolution was recorded" },
  { id: "identity-continuity", label: "Identity continuity", defaultNote: "no completed handle-history result was recorded" },
  {
    id: "affiliations-associates",
    label: "Affiliations & associates",
    defaultNote: "no corroborated affiliation collection outcome was recorded",
    criticalFor: ["KOL", "INVESTOR", "ADVISOR", "AGENCY", "MEMBER"]
  },
  { id: "promoted-token-performance", label: "Promoted-token performance", defaultNote: "no completed promoted-token market result was recorded", role: "KOL", criticalFor: ["KOL"] },
  { id: "project-token-identity", label: "Canonical project token", defaultNote: "no official token identity was bound to this project account", role: "PROJECT", criticalFor: ["PROJECT"] },
  { id: "project-product-substance", label: "Product and website substance", defaultNote: "no frozen first-party product or website outcome was recorded", role: "PROJECT", criticalFor: ["PROJECT"] },
  { id: "project-team-identity", label: "Project team identity", defaultNote: "no first-party team identity outcome was recorded", role: "PROJECT", criticalFor: ["PROJECT"] },
  { id: "project-backing-partners", label: "Backing and partners", defaultNote: "no source-backed project backing or partnership outcome was recorded", role: "PROJECT", criticalFor: ["PROJECT"] },
  { id: "project-traction-liveness", label: "Traction and liveness", defaultNote: "no frozen product, market, or activity-liveness outcome was recorded", role: "PROJECT", criticalFor: ["PROJECT"] },
  { id: "project-transparency", label: "Transparency and disclosures", defaultNote: "no frozen token, audit, docs, or disclosure outcome was recorded", role: "PROJECT", criticalFor: ["PROJECT"] },
  { id: "founder-identity-authority", label: "Verified identity and current authority", defaultNote: "the founder's identity and current decision-making role were not both verified", role: "FOUNDER", criticalFor: ["FOUNDER"] },
  { id: "founder-company-relationships", label: "Companies, co-founders, and current roles", defaultNote: "the founder's material company and co-founder relationships were not verified", role: "FOUNDER", criticalFor: ["FOUNDER"] },
  { id: "founder-track-record", label: "Track record and outcomes", defaultNote: "prior roles, exits, and venture outcomes were not verified", role: "FOUNDER", criticalFor: ["FOUNDER"] },
  { id: "founder-control-conflicts", label: "Control and conflicts", defaultNote: "governance control, ownership, and material conflicts were not verified", role: "FOUNDER", criticalFor: ["FOUNDER"] },
  { id: "founder-legal-regulatory", label: "Legal and regulatory history", defaultNote: "material legal or regulatory events and their attribution were not verified", role: "FOUNDER", criticalFor: ["FOUNDER"] },
  { id: "founder-asset-distinction", label: "Related assets and security/token distinction", defaultNote: "related public securities, native tokens, and other assets were not clearly distinguished", role: "FOUNDER", criticalFor: ["FOUNDER"] },
  { id: "vc-portfolio-track-record", label: "Portfolio track record", defaultNote: "no completed source-backed portfolio verification was recorded", role: "INVESTOR", criticalFor: ["INVESTOR"] },
  { id: "news-press", label: "News & press", defaultNote: "server collector did not run a news/press check" },
  // Sanctions, legal history, and flagged-subject graph reconciliation are
  // legal-grade decision gates, not provider diagnostics. A report must never
  // present as decision-ready clearance while they are unresolved.
  //  - us-legal-history gates every person role EXCEPT founders, whose
  //    founder-legal-regulatory question is the stronger, attribution-verified
  //    form of the same gate (a raw CourtListener name screen stays visible as
  //    a diagnostic for them).
  //  - ofac-sanctions-name gates EVERY person role including founders: no
  //    research check substitutes for an SDN screen.
  //  - trust-graph-connections gates every role: a subject tied to a flagged
  //    operation is the exact signal this product exists to surface.
  // All three stay conditional on scope (requiresResolvedRealName marks the
  // name screens not-applicable, never silently complete).
  {
    id: "us-legal-history",
    label: "US legal history",
    defaultNote: "server collector did not run a legal-history check",
    requiresResolvedRealName: true,
    criticalFor: ["KOL", "INVESTOR", "ADVISOR", "AGENCY", "MEMBER"]
  },
  {
    id: "ofac-sanctions-name",
    label: "OFAC sanctions (name)",
    defaultNote: "server collector did not run a name-sanctions check",
    requiresResolvedRealName: true,
    criticalFor: ["FOUNDER", "KOL", "INVESTOR", "ADVISOR", "AGENCY", "MEMBER"]
  },
  {
    id: "trust-graph-connections",
    label: "Trust-graph connections",
    defaultNote: "server collector did not run flagged-subject graph reconciliation",
    criticalFor: ["FOUNDER", "KOL", "INVESTOR", "ADVISOR", "AGENCY", "MEMBER", "PROJECT"]
  }
];
var PERSON_CHECK_IDS = Object.freeze(CHECKS.map((check) => check.id));
var LEGACY_PERSON_CHECK_IDS = Object.freeze([
  "identity-resolution",
  "profile-photo-authenticity",
  "code-footprint-github",
  "identity-continuity",
  "affiliations-associates",
  "promoted-token-performance",
  "vc-portfolio-track-record",
  "news-press",
  "us-legal-history",
  "ofac-sanctions-name",
  "trust-graph-connections"
]);
var PROJECT_DILIGENCE_PERSON_CHECK_IDS = Object.freeze([
  "identity-resolution",
  "profile-photo-authenticity",
  "code-footprint-github",
  "identity-continuity",
  "affiliations-associates",
  "promoted-token-performance",
  "project-token-identity",
  "project-product-substance",
  "project-team-identity",
  "project-backing-partners",
  "project-traction-liveness",
  "project-transparency",
  "vc-portfolio-track-record",
  "news-press",
  "us-legal-history",
  "ofac-sanctions-name",
  "trust-graph-connections"
]);
var STATUS_PRIORITY = {
  "not-applicable": 0,
  unknown: 1,
  unavailable: 2,
  stale: 3,
  "checked-empty": 4,
  confirmed: 5,
  finding: 6
};
var SUCCESS = /* @__PURE__ */ new Set(["confirmed", "finding", "checked-empty"]);
function iso(value) {
  const date = value ? new Date(value) : /* @__PURE__ */ new Date();
  return Number.isFinite(date.getTime()) ? date.toISOString() : (/* @__PURE__ */ new Date()).toISOString();
}
function uniqueObservations(values) {
  const seen = /* @__PURE__ */ new Set();
  return values.filter((value) => {
    const key = `${value.id}
${value.provider}
${value.status}
${value.note}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
var PersonCheckTracker = class {
  observations = /* @__PURE__ */ new Map();
  providerRuns = /* @__PURE__ */ new Map();
  record(observation) {
    const normalized4 = {
      ...observation,
      note: observation.note.trim(),
      provider: observation.provider.trim(),
      sourceCount: observation.sourceCount == null ? void 0 : Math.max(0, Math.floor(observation.sourceCount)),
      completedAt: iso(observation.completedAt)
    };
    if (!normalized4.note || !normalized4.provider) return;
    const current = this.observations.get(normalized4.id) ?? [];
    this.observations.set(normalized4.id, uniqueObservations([...current, normalized4]));
  }
  provider(id, label, state, detail) {
    this.providerRuns.set(id, {
      id,
      label,
      state,
      observedAt: (/* @__PURE__ */ new Date()).toISOString(),
      ...detail?.trim() ? { detail: detail.trim().slice(0, 500) } : {}
    });
  }
  snapshot(roles, scope = {}) {
    const heldRoles = new Set(roles);
    const projectOnly = heldRoles.size === 1 && heldRoles.has("PROJECT");
    return CHECKS.map((definition) => {
      const founderLegalSupersedesNameScreen = definition.id === "us-legal-history" && heldRoles.has("FOUNDER");
      const decisionCritical = !founderLegalSupersedesNameScreen && Boolean(
        definition.criticalFor?.some((criticalRole) => heldRoles.has(criticalRole))
      );
      if (definition.role && !heldRoles.has(definition.role)) {
        const roleNote = {
          FOUNDER: "not a founder",
          KOL: "not a KOL",
          INVESTOR: "not a fund/investor",
          PROJECT: "not a project account"
        };
        return Object.freeze({
          checkId: definition.id,
          label: definition.label,
          status: "not-applicable",
          note: roleNote[definition.role],
          decisionCritical: false
        });
      }
      if (definition.requiresResolvedRealName && scope.resolvedRealName === false) {
        return Object.freeze({
          checkId: definition.id,
          label: definition.label,
          status: "not-applicable",
          note: "requires a resolved real-person name",
          decisionCritical
        });
      }
      if (definition.requiresPersonRole && projectOnly) {
        return Object.freeze({
          checkId: definition.id,
          label: definition.label,
          status: "not-applicable",
          note: "not applicable to a project-only brand account",
          decisionCritical: false
        });
      }
      const observations = this.observations.get(definition.id) ?? [];
      if (!observations.length) {
        return Object.freeze({
          checkId: definition.id,
          label: definition.label,
          status: "unknown",
          note: definition.defaultNote,
          decisionCritical
        });
      }
      const strongest = observations.reduce(
        (best, candidate) => STATUS_PRIORITY[candidate.status] > STATUS_PRIORITY[best.status] ? candidate : best
      );
      const providers = [...new Set(observations.map((item) => item.provider))];
      const notes = [...new Set(observations.filter((item) => item.status === strongest.status || SUCCESS.has(item.status)).map((item) => item.note))];
      const sourceCount = observations.reduce((total, item) => total + (item.sourceCount ?? 0), 0);
      const completedAt = observations.map((item) => item.completedAt).filter((value) => !!value).sort().at(-1);
      return Object.freeze({
        checkId: definition.id,
        label: definition.label,
        status: strongest.status,
        note: notes.slice(0, 3).join(" \xB7 ") || strongest.note,
        decisionCritical,
        provider: providers.join(","),
        ...sourceCount > 0 ? { sourceCount } : {},
        ...completedAt ? { completedAt } : {}
      });
    });
  }
  completeness(roles, scope = {}) {
    return clearanceCoverage(this.snapshot(roles, scope)).sufficient ? "complete" : "partial";
  }
  providers() {
    return Object.freeze({
      capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
      runs: [...this.providerRuns.values()].map((run) => Object.freeze({ ...run }))
    });
  }
};

// server/cache.ts
import { createHash as createHash2 } from "node:crypto";
var TTL_MS = 24 * 3600 * 1e3;
function creds() {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SERVICE_KEY");
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}
var headers = (key) => ({
  apikey: key,
  ...!key.startsWith("sb_secret_") ? { authorization: `Bearer ${key}` } : {},
  "content-type": "application/json"
});
var hash = (s) => "gt:" + createHash2("sha256").update(s).digest("hex").slice(0, 40);
async function cacheGet(key, usage = {}) {
  const c = creds();
  if (!c) return null;
  try {
    const r = await fetch(
      `${c.url}/rest/v1/provider_cache?select=payload,expires_at&cache_key=eq.${encodeURIComponent(hash(key))}&limit=1`,
      { headers: headers(c.key), signal: AbortSignal.timeout(4e3) }
    );
    if (!r.ok) return null;
    const rows = await r.json();
    const p = rows?.[0]?.payload;
    const expiresAt = rows?.[0]?.expires_at ? Date.parse(rows[0].expires_at) : Number.NaN;
    if (!p?.text || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
    recordCall("cache", usage.operation ?? "grok-hit", 0, usage.meta ?? "24h search cache", "cached");
    return p.text;
  } catch {
    return null;
  }
}
async function cacheSet(key, text2) {
  const c = creds();
  if (!c || !text2) return;
  try {
    const now = Date.now();
    await fetch(`${c.url}/rest/v1/provider_cache?on_conflict=cache_key`, {
      method: "POST",
      headers: { ...headers(c.key), prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        cache_key: hash(key),
        payload: { text: text2 },
        expires_at: new Date(now + TTL_MS).toISOString(),
        updated_at: new Date(now).toISOString()
      }),
      signal: AbortSignal.timeout(4e3)
    });
  } catch {
  }
}

// server/adapters/notableAccounts.ts
var NOTABLE_ACCOUNTS = [
  // ── Venture funds / firm accounts ─────────────────────────────────────────
  { handle: "a16zcrypto", label: "VC \xB7 a16z crypto" },
  { handle: "paradigm", label: "VC \xB7 Paradigm" },
  { handle: "dragonfly_xyz", label: "VC \xB7 Dragonfly" },
  { handle: "multicoincap", label: "VC \xB7 Multicoin" },
  { handle: "VariantFund", label: "VC \xB7 Variant" },
  { handle: "FrameworkVC", label: "VC \xB7 Framework" },
  { handle: "hack_vc", label: "VC \xB7 Hack VC" },
  { handle: "PlaceholderVC", label: "VC \xB7 Placeholder" },
  { handle: "panteracapital", label: "VC \xB7 Pantera" },
  { handle: "1kxnetwork", label: "VC \xB7 1kx" },
  { handle: "electric_capital", label: "VC \xB7 Electric Capital" },
  { handle: "robotventures", label: "VC \xB7 Robot Ventures" },
  { handle: "polychaincap", label: "VC \xB7 Polychain" },
  { handle: "coinbaseventures", label: "VC \xB7 Coinbase Ventures" },
  { handle: "binancelabs", label: "VC \xB7 Binance Labs" },
  { handle: "HashKey_Capital", label: "VC \xB7 HashKey" },
  { handle: "sequoia", label: "VC \xB7 Sequoia" },
  { handle: "USV", label: "VC \xB7 Union Square Ventures" },
  { handle: "IOSG_VC", label: "VC \xB7 IOSG" },
  { handle: "hypersphere_x", label: "VC \xB7 Hypersphere" },
  { handle: "standardcrypto", label: "VC \xB7 Standard Crypto" },
  { handle: "blockchaincap", label: "VC \xB7 Blockchain Capital" },
  { handle: "galaxyhq", label: "VC \xB7 Galaxy" },
  { handle: "DelphiVentures", label: "VC \xB7 Delphi Ventures" },
  { handle: "DCGco", label: "VC \xB7 Digital Currency Group" },
  { handle: "gumi_cryptos", label: "VC \xB7 gumi Cryptos" },
  { handle: "SygnumOfficial", label: "VC \xB7 Sygnum" },
  { handle: "L2IV", label: "VC \xB7 L2 Iterative" },
  { handle: "maven11", label: "VC \xB7 Maven 11" },
  { handle: "nascentxyz", label: "VC \xB7 Nascent" },
  { handle: "bankless_vc", label: "VC \xB7 Bankless Ventures" },
  { handle: "SpartanGroup", label: "VC \xB7 Spartan" },
  { handle: "TheSpartanGroup", label: "VC \xB7 Spartan" },
  { handle: "6thmancapital", label: "VC \xB7 6th Man Ventures" },
  { handle: "archetypevc", label: "VC \xB7 Archetype" },
  { handle: "slowfund", label: "VC \xB7 Slow Ventures" },
  { handle: "portal_ventures", label: "VC \xB7 Portal Ventures" },
  { handle: "figmentcapital", label: "VC \xB7 Figment Capital" },
  { handle: "reforgevc", label: "VC \xB7 Reforge" },
  { handle: "foundationcap", label: "VC \xB7 Foundation Capital" },
  { handle: "castle_isl", label: "VC \xB7 Castle Island" },
  { handle: "lightspeedvp", label: "VC \xB7 Lightspeed" },
  { handle: "tribecap", label: "VC \xB7 Tribe Capital" },
  { handle: "roundtripcrypto", label: "VC \xB7 Round13" },
  { handle: "fabric_vc", label: "VC \xB7 Fabric Ventures" },
  { handle: "gsr_io", label: "market maker \xB7 GSR" },
  { handle: "wintermute_t", label: "market maker \xB7 Wintermute" },
  { handle: "jump_", label: "market maker \xB7 Jump" },
  { handle: "amberGroup_HQ", label: "market maker \xB7 Amber" },
  { handle: "cumberland_io", label: "market maker \xB7 Cumberland" },
  { handle: "flowtraders", label: "market maker \xB7 Flow Traders" },
  { handle: "mechanismcap", label: "fund \xB7 Mechanism" },
  { handle: "dcfgod", label: "fund \xB7 DCF God" },
  { handle: "arca", label: "fund \xB7 Arca" },
  { handle: "republiccrypto", label: "VC \xB7 Republic Crypto" },
  { handle: "animocabrands", label: "VC \xB7 Animoca" },
  { handle: "shima_capital", label: "VC \xB7 Shima" },
  { handle: "big_brain_hodl", label: "VC \xB7 Big Brain" },
  { handle: "collab_currency", label: "VC \xB7 Collab+Currency" },
  { handle: "roninvc", label: "VC \xB7 Ronin" },
  // ── VC partners / notable investors (individuals) ─────────────────────────
  { handle: "cdixon", label: "investor \xB7 a16z" },
  { handle: "balajis", label: "investor \xB7 Balaji" },
  { handle: "cyounessi1", label: "investor \xB7 Standard Crypto" },
  { handle: "hosseeb", label: "investor \xB7 Dragonfly" },
  { handle: "danrobinson", label: "investor \xB7 Paradigm" },
  { handle: "gakonst", label: "founder \xB7 Paradigm/Foundry" },
  { handle: "cburniske", label: "investor \xB7 Placeholder" },
  { handle: "twobitidiot", label: "founder \xB7 Messari (Ryan Selkis)" },
  { handle: "avichal", label: "investor \xB7 Electric Capital" },
  { handle: "Maria_Shen", label: "investor \xB7 Electric Capital" },
  { handle: "TarunChitra", label: "founder \xB7 Gauntlet" },
  { handle: "ljin18", label: "investor \xB7 Variant" },
  { handle: "jessewldn", label: "investor \xB7 Haun" },
  { handle: "kmoney_69", label: "investor \xB7 Placeholder" },
  { handle: "spencernoon", label: "investor \xB7 Variant" },
  { handle: "arjunblj", label: "investor \xB7 Reverie" },
  { handle: "TusharJain_", label: "investor \xB7 Multicoin" },
  { handle: "KyleSamani", label: "investor \xB7 Multicoin" },
  { handle: "santiagoroel", label: "investor \xB7 Amber/Delphi" },
  { handle: "Anup_Bagchi", label: "investor" },
  { handle: "0xMaki", label: "investor \xB7 founder (Sushi)" },
  { handle: "ChrisBurniske", label: "investor \xB7 Placeholder" },
  { handle: "RobHadick", label: "investor \xB7 Dragonfly" },
  { handle: "Rewkang", label: "investor \xB7 Mechanism" },
  { handle: "adam_tehc", label: "investor" },
  { handle: "dberenzon", label: "investor" },
  { handle: "packyM", label: "investor \xB7 Not Boring" },
  { handle: "nlw", label: "media \xB7 The Breakdown" },
  { handle: "lawmaster", label: "investor \xB7 Framework (Vance Spencer)" },
  { handle: "MikeDudas", label: "investor \xB7 6MV" },
  { handle: "iamDCinvestor", label: "investor \xB7 ETH OG" },
  { handle: "AriDavidPaul", label: "investor \xB7 BlockTower" },
  { handle: "APompliano", label: "investor \xB7 Pomp" },
  { handle: "RaoulGMI", label: "investor \xB7 Real Vision" },
  { handle: "novogratz", label: "investor \xB7 Galaxy (Mike Novogratz)" },
  { handle: "cathiedwood", label: "investor \xB7 ARK" },
  { handle: "woonomic", label: "analyst \xB7 Willy Woo" },
  // ── Founders / builders ───────────────────────────────────────────────────
  { handle: "VitalikButerin", label: "founder \xB7 Ethereum" },
  { handle: "aeyakovenko", label: "founder \xB7 Solana" },
  { handle: "rajgokal", label: "founder \xB7 Solana" },
  { handle: "jessepollak", label: "founder \xB7 Base" },
  { handle: "haydenzadams", label: "founder \xB7 Uniswap" },
  { handle: "StaniKulechov", label: "founder \xB7 Aave" },
  { handle: "sreeramkannan", label: "founder \xB7 EigenLayer" },
  { handle: "smokey_eth", label: "founder \xB7 Berachain" },
  { handle: "0xngmi", label: "founder \xB7 DefiLlama" },
  { handle: "gabrielhaines", label: "founder" },
  { handle: "brendaneich", label: "founder \xB7 Brave" },
  { handle: "sassal0x", label: "Ethereum advocate" },
  { handle: "econoar", label: "founder \xB7 Eric Conner" },
  { handle: "drakefjustin", label: "researcher \xB7 Ethereum Foundation" },
  { handle: "dannyryan", label: "researcher \xB7 Ethereum Foundation" },
  { handle: "TimBeiko", label: "Ethereum core" },
  { handle: "epolynya", label: "researcher \xB7 rollups" },
  { handle: "el33th4xor", label: "founder \xB7 Ava Labs (Emin G\xFCn Sirer)" },
  { handle: "zhusu", label: "founder \xB7 3AC (Su Zhu)" },
  { handle: "MacroCephalopod", label: "founder \xB7 Reserve" },
  { handle: "robertleshner", label: "founder \xB7 Compound" },
  { handle: "kaiynne", label: "founder \xB7 Synthetix" },
  { handle: "AndreCronjeTech", label: "founder \xB7 Yearn/Fantom" },
  { handle: "bantg", label: "founder \xB7 Yearn" },
  { handle: "danielesesta", label: "founder \xB7 Wonderland/Abracadabra" },
  { handle: "kaledora", label: "founder" },
  { handle: "eric_wallach", label: "founder" },
  { handle: "0xSisyphus", label: "trader/founder" },
  { handle: "MustStopMurad", label: "founder \xB7 Memecoin thesis" },
  { handle: "shawmakesmagic", label: "founder \xB7 ai16z/eliza" },
  { handle: "everythingempt0", label: "trader/founder" },
  { handle: "0xzerebro", label: "founder \xB7 AI agent" },
  { handle: "luna_virtuals", label: "founder \xB7 Virtuals" },
  { handle: "punk9059", label: "founder" },
  { handle: "0xMert_", label: "founder \xB7 Helius" },
  { handle: "rogercrypto", label: "founder" },
  { handle: "toly", label: "founder \xB7 Solana" },
  { handle: "kayceecrypto", label: "founder" },
  { handle: "loomdart", label: "trader \xB7 OG" },
  { handle: "cobie", label: "trader \xB7 UpOnly (Cobie)" },
  { handle: "ledgerstatus", label: "trader \xB7 OG" },
  { handle: "dcfgod", label: "trader" },
  { handle: "cyrusof", label: "founder" },
  { handle: "0xdesigner", label: "builder/designer" },
  { handle: "transmissions11", label: "engineer \xB7 Paradigm" },
  { handle: "boredGenius", label: "engineer \xB7 dYdX" },
  { handle: "antonio_m_juliano", label: "founder \xB7 dYdX" },
  { handle: "0age", label: "engineer \xB7 Uniswap" },
  { handle: "haydenzadams", label: "founder \xB7 Uniswap" },
  { handle: "monosarin", label: "founder \xB7 Polymarket (Shayne Coplan)" },
  { handle: "shayne_coplan", label: "founder \xB7 Polymarket" },
  { handle: "gavofyork", label: "founder \xB7 Polkadot/Parity" },
  { handle: "rune_christensen", label: "founder \xB7 MakerDAO/Sky" },
  { handle: "kaiynne", label: "founder \xB7 Synthetix" },
  { handle: "coopahtroopa", label: "builder \xB7 music/NFTs" },
  { handle: "cryptopunk7213", label: "founder \xB7 Compound (Robert Leshner alt)" },
  // ── KOLs / callers / traders ──────────────────────────────────────────────
  { handle: "blknoiz06", label: "caller \xB7 Ansem" },
  { handle: "CryptoKaleo", label: "caller \xB7 Kaleo" },
  { handle: "inversebrah", label: "KOL" },
  { handle: "CryptoCred", label: "trader" },
  { handle: "HsakaTrades", label: "trader \xB7 Hsaka" },
  { handle: "notthreadguy", label: "KOL" },
  { handle: "theunipcs", label: "caller \xB7 Bonk guy" },
  { handle: "CryptoGodJohn", label: "caller" },
  { handle: "frankdegods", label: "founder/KOL \xB7 DeGods" },
  { handle: "GiganticRebirth", label: "trader \xB7 GCR" },
  { handle: "Pentosh1", label: "trader" },
  { handle: "TheCryptoDog", label: "trader" },
  { handle: "Tetranode", label: "whale" },
  { handle: "DeFiGod1", label: "trader" },
  { handle: "gainzy222", label: "trader" },
  { handle: "AltcoinPsycho", label: "trader" },
  { handle: "smallcapscience", label: "KOL" },
  { handle: "SmartestMoney_", label: "trader" },
  { handle: "CredibleCrypto", label: "trader" },
  { handle: "CryptoMessiah", label: "trader" },
  { handle: "IamNomad", label: "trader" },
  { handle: "AltcoinGordon", label: "KOL" },
  { handle: "CryptoTony__", label: "trader" },
  { handle: "rektcapital", label: "analyst" },
  { handle: "CryptoDonAlt", label: "trader \xB7 DonAlt" },
  { handle: "koroushak", label: "trader" },
  { handle: "TheFlowHorse", label: "trader \xB7 Flood" },
  { handle: "MacnBTC", label: "trader" },
  { handle: "0xWangarian", label: "trader" },
  { handle: "IncomeSharks", label: "trader" },
  { handle: "PostyXBT", label: "trader" },
  { handle: "0x_Kun", label: "trader" },
  { handle: "cobie", label: "trader \xB7 Cobie" },
  { handle: "0xSisyphus", label: "trader" },
  { handle: "loomdart", label: "trader" },
  { handle: "shahh", label: "trader" },
  { handle: "CL207", label: "trader" },
  { handle: "satsdart", label: "trader" },
  { handle: "cozypront", label: "trader" },
  { handle: "0xngmi", label: "founder/analyst" },
  { handle: "eth_daddy", label: "trader" },
  { handle: "ThinkingUSD", label: "trader \xB7 Flood" },
  { handle: "poordart", label: "trader" },
  { handle: "gainzy", label: "trader" },
  { handle: "hentaavi", label: "trader" },
  { handle: "iloveponzi", label: "trader" },
  { handle: "mesawine1", label: "trader" },
  { handle: "0xShual", label: "trader" },
  { handle: "greg16676935420", label: "KOL \xB7 Greg" },
  { handle: "notlarrylink", label: "KOL" },
  { handle: "chooserich", label: "KOL" },
  { handle: "traderpow", label: "trader" },
  { handle: "MoonOverlord", label: "trader" },
  { handle: "cryptoyieldinfo", label: "analyst" },
  { handle: "TashaKKK", label: "KOL" },
  { handle: "zoomerfren", label: "KOL" },
  // ── Protocols / infra (official accounts) ─────────────────────────────────
  { handle: "solana", label: "infra \xB7 Solana" },
  { handle: "ethereum", label: "infra \xB7 Ethereum" },
  { handle: "base", label: "infra \xB7 Base" },
  { handle: "arbitrum", label: "infra \xB7 Arbitrum" },
  { handle: "optimism", label: "infra \xB7 Optimism" },
  { handle: "0xPolygon", label: "infra \xB7 Polygon" },
  { handle: "avax", label: "infra \xB7 Avalanche" },
  { handle: "Uniswap", label: "protocol \xB7 Uniswap" },
  { handle: "aave", label: "protocol \xB7 Aave" },
  { handle: "chainlink", label: "infra \xB7 Chainlink" },
  { handle: "MakerDAO", label: "protocol \xB7 Maker/Sky" },
  { handle: "LidoFinance", label: "protocol \xB7 Lido" },
  { handle: "eigenlayer", label: "protocol \xB7 EigenLayer" },
  { handle: "pumpdotfun", label: "infra \xB7 Pump.fun" },
  { handle: "jito_sol", label: "infra \xB7 Jito" },
  { handle: "heliuslabs", label: "infra \xB7 Helius" },
  { handle: "JupiterExchange", label: "protocol \xB7 Jupiter" },
  { handle: "RaydiumProtocol", label: "protocol \xB7 Raydium" },
  { handle: "DriftProtocol", label: "protocol \xB7 Drift" },
  { handle: "KaminoFinance", label: "protocol \xB7 Kamino" },
  { handle: "MarginFi", label: "protocol \xB7 marginfi" },
  { handle: "tensor_hq", label: "protocol \xB7 Tensor" },
  { handle: "MagicEden", label: "protocol \xB7 Magic Eden" },
  { handle: "phantom", label: "infra \xB7 Phantom" },
  { handle: "MetaMask", label: "infra \xB7 MetaMask" },
  { handle: "dYdX", label: "protocol \xB7 dYdX" },
  { handle: "GMX_IO", label: "protocol \xB7 GMX" },
  { handle: "PendleIntern", label: "protocol \xB7 Pendle" },
  { handle: "ethena_labs", label: "protocol \xB7 Ethena" },
  { handle: "MorphoLabs", label: "protocol \xB7 Morpho" },
  { handle: "CurveFinance", label: "protocol \xB7 Curve" },
  { handle: "convexfinance", label: "protocol \xB7 Convex" },
  { handle: "friedtech", label: "infra" },
  { handle: "monad_xyz", label: "infra \xB7 Monad" },
  { handle: "berachain", label: "infra \xB7 Berachain" },
  { handle: "SuiNetwork", label: "infra \xB7 Sui" },
  { handle: "Aptos", label: "infra \xB7 Aptos" },
  { handle: "celestia", label: "infra \xB7 Celestia" },
  { handle: "hyperliquid_x", label: "protocol \xB7 Hyperliquid" },
  { handle: "VirtualsProtocol", label: "protocol \xB7 Virtuals" },
  // ── Exchanges ─────────────────────────────────────────────────────────────
  { handle: "coinbase", label: "exchange \xB7 Coinbase" },
  { handle: "binance", label: "exchange \xB7 Binance" },
  { handle: "krakenfx", label: "exchange \xB7 Kraken" },
  { handle: "okx", label: "exchange \xB7 OKX" },
  { handle: "Bybit_Official", label: "exchange \xB7 Bybit" },
  { handle: "coinbasewallet", label: "infra \xB7 Coinbase Wallet" },
  { handle: "brian_armstrong", label: "founder \xB7 Coinbase" },
  { handle: "cz_binance", label: "founder \xB7 Binance" },
  { handle: "cryptohayes", label: "founder \xB7 BitMEX (Arthur Hayes)" },
  { handle: "SBF_FTX", label: "founder \xB7 FTX (defunct)" },
  { handle: "jespow", label: "founder \xB7 Kraken" },
  { handle: "tyler", label: "founder \xB7 Gemini (Winklevoss)" },
  { handle: "cameron", label: "founder \xB7 Gemini (Winklevoss)" },
  // ── Researchers / analysts / media / security ─────────────────────────────
  { handle: "MessariCrypto", label: "research \xB7 Messari" },
  { handle: "DelphiDigital", label: "research \xB7 Delphi" },
  { handle: "tokenterminal", label: "research \xB7 Token Terminal" },
  { handle: "DefiLlama", label: "data \xB7 DefiLlama" },
  { handle: "nansen_ai", label: "data \xB7 Nansen" },
  { handle: "ArkhamIntel", label: "data \xB7 Arkham" },
  { handle: "lookonchain", label: "on-chain analyst" },
  { handle: "spotonchain", label: "on-chain analyst" },
  { handle: "zachxbt", label: "investigator \xB7 ZachXBT" },
  { handle: "tayvano_", label: "security \xB7 MyCrypto (Tay)" },
  { handle: "officer_cia", label: "security researcher" },
  { handle: "samczsun", label: "security \xB7 Paradigm" },
  { handle: "bantg", label: "engineer \xB7 Yearn" },
  { handle: "peckshield", label: "security \xB7 PeckShield" },
  { handle: "CertiK", label: "security \xB7 CertiK" },
  { handle: "RugDocIO", label: "security \xB7 RugDoc" },
  { handle: "WatcherGuru", label: "media" },
  { handle: "Cointelegraph", label: "media" },
  { handle: "CoinDesk", label: "media" },
  { handle: "TheBlock__", label: "media \xB7 The Block" },
  { handle: "BanklessHQ", label: "media \xB7 Bankless" },
  { handle: "laurashin", label: "media \xB7 Unchained" },
  { handle: "wublockchain", label: "media \xB7 Wu Blockchain" },
  { handle: "DegenerateNews", label: "media" },
  { handle: "unusual_whales", label: "data/flow" },
  // ── Expansion batch: more founders / L1-L2 leaders ────────────────────────
  { handle: "zhuoxun_yin", label: "founder \xB7 Manta" },
  { handle: "0xkyle__", label: "researcher" },
  { handle: "dabit3", label: "developer advocate (Nader)" },
  { handle: "austingriffith", label: "builder \xB7 Ethereum (scaffold-eth)" },
  { handle: "PatrickAlphaC", label: "developer educator" },
  { handle: "hudsonjameson", label: "Ethereum community" },
  { handle: "vladtenev", label: "founder \xB7 Robinhood" },
  { handle: "jack", label: "founder \xB7 Block/Twitter" },
  { handle: "elonmusk", label: "founder \xB7 Tesla/X" },
  { handle: "saylor", label: "founder \xB7 MicroStrategy (Michael Saylor)" },
  { handle: "APompliano", label: "investor \xB7 Pomp" },
  { handle: "TylerDurden", label: "media \xB7 ZeroHedge" },
  { handle: "DavidGokhshtein", label: "KOL \xB7 Gokhshtein" },
  { handle: "scottmelker", label: "KOL \xB7 Wolf of All Streets" },
  { handle: "TheCryptoLark", label: "KOL \xB7 Lark Davis" },
  { handle: "IvanOnTech", label: "KOL \xB7 Ivan" },
  { handle: "AltCryptoGems", label: "KOL" },
  { handle: "CryptoWendyO", label: "KOL" },
  { handle: "girlgone_crypto", label: "KOL" },
  { handle: "CryptoTubers", label: "KOL" },
  { handle: "PeterLBrandt", label: "trader \xB7 legacy TA" },
  { handle: "cryptomanran", label: "KOL" },
  { handle: "EllioTrades", label: "KOL" },
  { handle: "sassal0x", label: "Ethereum advocate" },
  { handle: "milesdeutscher", label: "KOL \xB7 analyst" },
  { handle: "CryptoBusy", label: "KOL" },
  { handle: "Ashcryptoreal", label: "KOL" },
  { handle: "cobie", label: "trader \xB7 Cobie" },
  { handle: "0xLouisT", label: "founder/investor" },
  { handle: "DeFianceCapital", label: "fund \xB7 DeFiance" },
  { handle: "arthur_0x", label: "founder \xB7 DeFiance (Arthur Cheong)" },
  { handle: "ThreeSigmaXYZ", label: "research \xB7 Three Sigma" },
  { handle: "tokenbrice", label: "DeFi analyst" },
  { handle: "DefiIgnas", label: "DeFi researcher" },
  { handle: "thedefiedge", label: "DeFi researcher" },
  { handle: "Dynamo_Patrick", label: "DeFi researcher" },
  { handle: "korpi87", label: "DeFi researcher" },
  { handle: "0xLoke", label: "DeFi researcher" },
  { handle: "0x_Todd", label: "researcher" },
  { handle: "route2fi", label: "DeFi researcher" },
  { handle: "stacy_muur", label: "DeFi researcher" },
  { handle: "TheDeFiSaint", label: "DeFi analyst" },
  { handle: "0xMinion", label: "researcher" },
  { handle: "MrBlocks_", label: "researcher" },
  { handle: "Flowslikeosmo", label: "researcher" },
  { handle: "CryptoKoryo", label: "data analyst" },
  { handle: "0xfoobar", label: "engineer/researcher" },
  { handle: "cygaar_dev", label: "engineer" },
  { handle: "pcaversaccio", label: "security engineer" },
  { handle: "brockelmore", label: "engineer \xB7 Paradigm" },
  { handle: "andyfeng21", label: "founder \xB7 EigenLayer" },
  { handle: "ryanberckmans", label: "researcher" },
  { handle: "poopmandefi", label: "trader" },
  { handle: "yashhsm", label: "trader" },
  { handle: "0xdoge_", label: "trader" },
  { handle: "0xraceralt", label: "trader" },
  { handle: "0xSweep", label: "trader" },
  { handle: "cryptorinweb3", label: "KOL" },
  { handle: "moon_shiller", label: "KOL" },
  { handle: "0xUnihax0r", label: "trader" },
  { handle: "himgajria", label: "investor" },
  { handle: "lightcrypto", label: "trader" },
  { handle: "gainzy222", label: "trader" },
  { handle: "0xTindorr", label: "trader" },
  { handle: "0xngmi", label: "founder \xB7 DefiLlama" },
  { handle: "adamscochran", label: "investor \xB7 Cinneamhain" },
  { handle: "TheOneandOmsy", label: "trader" },
  { handle: "ColeGarnerHODL", label: "analyst" },
  { handle: "checkmatey_", label: "on-chain analyst \xB7 Glassnode" },
  { handle: "_Checkmatey", label: "on-chain analyst" },
  { handle: "glassnode", label: "data \xB7 Glassnode" },
  { handle: "santimentfeed", label: "data \xB7 Santiment" },
  { handle: "intotheblock", label: "data \xB7 IntoTheBlock" },
  { handle: "coinmetrics", label: "data \xB7 Coin Metrics" },
  { handle: "nic__carter", label: "investor \xB7 Castle Island" },
  { handle: "lopp", label: "Bitcoin \xB7 Jameson Lopp" },
  { handle: "adam3us", label: "founder \xB7 Blockstream (Adam Back)" },
  { handle: "aantonop", label: "Bitcoin educator" },
  { handle: "pete_rizzo_", label: "Bitcoin historian" },
  { handle: "DocumentingBTC", label: "Bitcoin media" },
  { handle: "matt_odell", label: "Bitcoin \xB7 Odell" },
  { handle: "gladstein", label: "Bitcoin \xB7 HRF" },
  { handle: "prestonpysh", label: "investor \xB7 Bitcoin" },
  { handle: "dergigi", label: "Bitcoin author" },
  { handle: "TuurDemeester", label: "investor \xB7 Bitcoin" },
  { handle: "MartyBent", label: "Bitcoin \xB7 TFTC" },
  { handle: "Excellion", label: "Bitcoin \xB7 Samson Mow" },
  { handle: "ErikVoorhees", label: "founder \xB7 ShapeShift" },
  { handle: "brian_armstrong", label: "founder \xB7 Coinbase" },
  { handle: "haydenzadams", label: "founder \xB7 Uniswap" },
  { handle: "danheld", label: "Bitcoin educator" },
  { handle: "CryptoCobain", label: "trader \xB7 Cobie alt" }
];

// server/adapters/x.ts
var TWITTERAPI = "https://api.twitterapi.io";
var asRecord2 = (value) => value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
var optionalNumber = (value) => typeof value === "number" && Number.isFinite(value) ? value : void 0;
var twitterProviderFailure = (payload) => {
  const status = typeof payload.status === "string" ? payload.status.trim().toLowerCase() : "";
  if (["error", "failed", "failure"].includes(status)) return `provider_status_${status}`;
  if (payload.success === false) return "provider_success_false";
  if (payload.data === null) return "provider_data_null";
  return null;
};
async function grokSearch(system, user, opts) {
  const key = env("XAI_API_KEY");
  if (!key) return null;
  if (opts?.cacheKey && !opts.bypassCache) {
    const hit = await cacheGet(opts.cacheKey);
    if (hit) return hit;
  }
  const call = async (withCap) => {
    if (opts?.claimProviderCall && !opts.claimProviderCall()) {
      return { status: null, text: null, budgetExhausted: true };
    }
    let res;
    try {
      res = await fetch("https://api.x.ai/v1/responses", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: env("ARGUS_GROK_MODEL") || "grok-4-fast",
          input: [{ role: "system", content: system }, { role: "user", content: user }],
          tools: [{ type: "web_search" }, { type: "x_search" }],
          ...withCap ? { max_tool_calls: opts?.maxToolCalls ?? 6 } : {}
        }),
        signal: AbortSignal.timeout(45e3)
      });
    } catch {
      addGrokUsage(void 0, 0, "live-search", "failed", "transport_error");
      return { status: null, text: null };
    }
    if (!res.ok) {
      addGrokUsage(void 0, 0, "live-search", "failed", `http_${res.status}`);
      return { status: res.status, text: null };
    }
    let d;
    try {
      d = asRecord2(await res.json());
    } catch {
      addGrokUsage(void 0, 0, "live-search", "failed", "response_json_error");
      return { status: res.status, text: null };
    }
    const output = Array.isArray(d.output) ? d.output.map(asRecord2) : [];
    const toolCalls = output.length ? output.filter((item) => /search|tool/.test(String(item.type ?? ""))).length : void 0;
    const usageRecord = asRecord2(d.usage);
    const usage = {
      input_tokens: optionalNumber(usageRecord.input_tokens),
      output_tokens: optionalNumber(usageRecord.output_tokens),
      num_sources_used: optionalNumber(usageRecord.num_sources_used)
    };
    const nestedText = output.flatMap((item) => Array.isArray(item.content) ? item.content.map(asRecord2) : []).map((content) => typeof content.text === "string" ? content.text : "").join(" ");
    const text2 = typeof d.output_text === "string" ? d.output_text : nestedText;
    console.log("[grok-usage]", JSON.stringify({ in: usage.input_tokens, out: usage.output_tokens, toolCalls }));
    addGrokUsage(
      usage,
      toolCalls,
      "live-search",
      text2 ? "succeeded" : "partial",
      text2 ? void 0 : "empty_output"
    );
    return { status: res.status, text: text2 || null };
  };
  let result = await call(true);
  if (result.status === 400 && !result.budgetExhausted) result = await call(false);
  if (result.text && opts?.cacheKey && !opts.bypassCache) void cacheSet(opts.cacheKey, result.text);
  return result.text;
}
async function twFetch(url, key, tries = 2) {
  const op = url.match(/\/twitter\/([a-z_/]+)/i)?.[1] ?? "other";
  for (let i = 0; i < tries; i++) {
    let res;
    try {
      res = await fetch(url, {
        headers: { "x-api-key": key },
        signal: AbortSignal.timeout(1e4)
      });
    } catch {
      recordTwitterapi(op, "failed", "transport_error");
      if (i + 1 >= tries) return null;
      await new Promise((resolve) => setTimeout(resolve, 700 * (i + 1)));
      continue;
    }
    if (!res.ok) {
      recordTwitterapi(op, "failed", `http_${res.status}`);
    } else {
      try {
        const payload = asRecord2(await res.clone().json());
        const providerFailure = twitterProviderFailure(payload);
        recordTwitterapi(op, providerFailure ? "failed" : "succeeded", providerFailure ?? void 0);
      } catch {
        recordTwitterapi(op, "failed", "response_json_error");
      }
    }
    if (res.status !== 429 && res.status !== 502 && res.status !== 503) return res;
    if (i + 1 >= tries) return res;
    await new Promise((r) => setTimeout(r, res.status === 429 ? 1200 : 700 * (i + 1)));
  }
  return null;
}
function pickWebsite(p) {
  const cands = [
    p?.profile_bio?.entities?.url?.urls?.[0]?.expanded_url,
    p?.entities?.url?.urls?.[0]?.expanded_url,
    p?.url,
    p?.profile_url,
    p?.website,
    p?.link
  ].filter((x) => typeof x === "string" && /^https?:\/\//i.test(x));
  return cands[0];
}
async function getProfile2(handle) {
  const key = env("TWITTERAPI_KEY");
  if (!key) return null;
  const u = handle.replace(/^@/, "");
  const url = `${TWITTERAPI}/twitter/user/info?userName=${encodeURIComponent(u)}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await twFetch(url, key);
      if (!res || !res.ok) return null;
      const d = await res.json();
      if (d?.status === "error" || d?.data === null) {
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        return null;
      }
      const p = d.data ?? d;
      if (!p || p.name == null && p.followers == null && p.followers_count == null && p.description == null) return null;
      const rawImg = p.profilePicture ?? p.profile_image_url_https ?? p.profile_image_url ?? p.profile_image;
      const image = typeof rawImg === "string" ? rawImg.replace(/_normal\.(jpg|jpeg|png|gif|webp)$/i, "_400x400.$1") : void 0;
      return {
        handle: "@" + u,
        name: p.name,
        bio: p.description,
        followers: p.followers ?? p.followers_count,
        createdAt: p.createdAt ?? p.created_at,
        website: pickWebsite(p),
        image
      };
    } catch {
      return null;
    }
  }
  return null;
}
async function handleHistory(handle) {
  const u = handle.replace(/^@/, "");
  let response;
  try {
    response = await fetch(`https://api.memory.lol/v1/tw/${encodeURIComponent(u)}`, { signal: AbortSignal.timeout(8e3) });
  } catch {
    recordCall("memory.lol", "tw-history", 0, "transport_error", "failed");
    return null;
  }
  if (!response.ok) {
    recordCall("memory.lol", "tw-history", 0, `http_${response.status}`, "failed");
    return null;
  }
  let parsed;
  try {
    parsed = await response.json();
  } catch {
    recordCall("memory.lol", "tw-history", 0, "response_json_error", "failed");
    return null;
  }
  const envelope = asRecord2(parsed);
  if (!Array.isArray(envelope.accounts)) {
    recordCall("memory.lol", "tw-history", 0, "invalid_result_shape", "partial");
    return null;
  }
  if (!envelope.accounts.length) {
    recordCall("memory.lol", "tw-history", 0, "no_match", "succeeded");
    return { priorHandles: [] };
  }
  const acct = asRecord2(envelope.accounts[0]);
  if (!acct.screen_names || typeof acct.screen_names !== "object" || Array.isArray(acct.screen_names)) {
    recordCall("memory.lol", "tw-history", 0, "screen_names_missing", "partial");
    return { priorHandles: [], ...typeof acct.id_str === "string" ? { idStr: acct.id_str } : {} };
  }
  const names = Object.keys(acct.screen_names);
  const prior = names.filter((n) => n.toLowerCase() !== u.toLowerCase());
  recordCall("memory.lol", "tw-history", 0, prior.length ? "history_found" : "no_prior_handles", "succeeded");
  return { priorHandles: prior, ...typeof acct.id_str === "string" ? { idStr: acct.id_str } : {} };
}
async function getRecentPosts(handle, limit = 20) {
  const key = env("TWITTERAPI_KEY");
  if (!key) return [];
  const u = handle.replace(/^@/, "");
  try {
    const res = await twFetch(`${TWITTERAPI}/twitter/user/last_tweets?userName=${encodeURIComponent(u)}`, key);
    if (!res || !res.ok) return [];
    const d = await res.json();
    const tweets = d.data?.tweets ?? d.tweets ?? (Array.isArray(d.data) ? d.data : []);
    return tweets.map((t) => t.text ?? t.full_text ?? "").filter(Boolean).slice(0, limit);
  } catch {
    return [];
  }
}
async function getRecentPostsMeta(handle, limit = 40) {
  const key = env("TWITTERAPI_KEY");
  if (!key) return [];
  const u = handle.replace(/^@/, "");
  try {
    const res = await twFetch(`${TWITTERAPI}/twitter/user/last_tweets?userName=${encodeURIComponent(u)}`, key);
    if (!res || !res.ok) return [];
    const d = await res.json();
    const tweets = d.data?.tweets ?? d.tweets ?? (Array.isArray(d.data) ? d.data : []);
    return tweets.map((t) => ({ text: t.text ?? t.full_text ?? "", createdAt: Date.parse(t.createdAt ?? t.created_at ?? "") })).filter((t) => t.text && Number.isFinite(t.createdAt)).slice(0, limit);
  } catch {
    return [];
  }
}
var num = (...v) => {
  for (const x of v) if (typeof x === "number") return x;
  return void 0;
};
var KW_IDENTITY = [
  "founder",
  "co-founder",
  "cofounder",
  "CEO",
  "CTO",
  "advisor",
  '"I built"',
  '"we built"',
  '"joined as"',
  "founded",
  // Project accounts often disclose public operators as a roster rather than
  // repeating formal titles. These retrieval terms feed the strict project-
  // owned role grammar below; they do not establish team membership by alone.
  '"our team"',
  '"team member"',
  '"members of"',
  '"core team"'
];
var KW_LAUNCH = ["launching", "presale", "mint", "airdrop", "raised", "seed", "IDO", '"CA:"', "tokenomics", "whitelist"];
var KW_ENDORSE = ["backed", "investors", "partnership", "gem", "100x", '"proud to"'];
var KW_SHILL = ["aped", "sending", '"the play"', "entry", "accumulated", "conviction", "printing", "pumping", "calling", "chart", '"my bag"', "loaded"];
var KW_CALLS = ["dexscreener.com", "pump.fun", "birdeye.so", "dextools.io", "geckoterminal.com", "photon-sol", '"CA"'];
var CLAIM_RE = /\b(founder|co-?founder|ceo|cto|advisor|founded|building|built|launch|presale|mint|airdrop|raised|seed|series [a-d]|ido|tokenomics|backed|investors?|partnership|gem|100x|joined|aped?|shill|calling|conviction|printing|pumping|sending it)\b/i;
function parseTweet(t) {
  const text2 = (t.text ?? t.full_text ?? "").trim();
  const at = Date.parse(t.createdAt ?? t.created_at ?? "");
  const isRt = /^RT @/.test(text2) || !!t.retweeted_tweet || !!t.retweeted_status || t.isRetweet === true;
  const isReply = !!(t.isReply ?? t.inReplyToId ?? t.in_reply_to_status_id ?? t.in_reply_to_user_id) || /^@\w/.test(text2);
  return {
    text: text2,
    at: Number.isFinite(at) ? at : null,
    views: num(t.viewCount, t.view_count, t.views) ?? 0,
    likes: num(t.likeCount, t.favorite_count, t.favoriteCount, t.likes) ?? 0,
    isReply,
    isRt
  };
}
async function lastTweetsPage(handle, key, cursor) {
  const res = await twFetch(`${TWITTERAPI}/twitter/user/last_tweets?userName=${encodeURIComponent(handle)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, key);
  if (!res || !res.ok) return { tweets: [] };
  const d = await res.json();
  const tweets = d.data?.tweets ?? d.tweets ?? (Array.isArray(d.data) ? d.data : []);
  return { tweets, next: d.has_next_page ? d.next_cursor : void 0 };
}
async function searchFrom(handle, terms, key) {
  const q = `from:${handle} (${terms.join(" OR ")})`;
  const res = await twFetch(`${TWITTERAPI}/twitter/tweet/advanced_search?query=${encodeURIComponent(q)}&queryType=Top`, key);
  if (!res || !res.ok) return [];
  const d = await res.json();
  return d.tweets ?? d.data?.tweets ?? [];
}
var stamp = (p) => {
  const when = p.at ? new Date(p.at).toLocaleString("en-US", { month: "short", year: "numeric" }) : "";
  const v = p.views >= 1e3 ? `${Math.round(p.views / 1e3)}k views` : p.views ? `${p.views} views` : "";
  const meta = [when, v].filter(Boolean).join(" \xB7 ");
  return (meta ? `[${meta}] ` : "") + p.text;
};
async function collectCorpus(handle) {
  const key = env("TWITTERAPI_KEY");
  const u = handle.replace(/^@/, "");
  if (!key) return { posts: [], newest: [], count: { originals: 0, searched: 0, ranked: 0 } };
  const p1 = await lastTweetsPage(u, key).catch(() => ({ tweets: [], next: void 0 }));
  const [p2, sId, sLa, sEn, sSh, sCa] = await Promise.all([
    p1.next ? lastTweetsPage(u, key, p1.next).catch(() => ({ tweets: [] })) : Promise.resolve({ tweets: [] }),
    searchFrom(u, KW_IDENTITY, key).catch(() => []),
    searchFrom(u, KW_LAUNCH, key).catch(() => []),
    searchFrom(u, KW_ENDORSE, key).catch(() => []),
    searchFrom(u, KW_SHILL, key).catch(() => []),
    searchFrom(u, KW_CALLS, key).catch(() => [])
  ]);
  const originalsRaw = [...p1.tweets, ...p2.tweets].map(parseTweet).filter((p) => p.text && !p.isReply && !p.isRt);
  const searchedRaw = [...sId, ...sLa, ...sEn, ...sSh, ...sCa].map(parseTweet).filter((p) => p.text && !p.isRt);
  const seen = /* @__PURE__ */ new Set();
  const dedup = (arr) => arr.filter((p) => {
    const k = p.text.slice(0, 80).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const originals = dedup(originalsRaw);
  const searched = dedup(searchedRaw);
  const all = [...originals, ...searched];
  const now = Date.now();
  const CASHTAG = /\$[A-Za-z][A-Za-z0-9]{1,9}\b/g;
  const CHARTLINK = /dexscreener\.com|pump\.fun|birdeye\.so|dextools\.io|geckoterminal\.com|photon-sol|\bCA[:\s]/i;
  const score = (p) => {
    const kw = (p.text.match(new RegExp(CLAIM_RE.source, "gi")) ?? []).length;
    const cashtags = (p.text.match(CASHTAG) ?? []).length;
    const call = (cashtags > 0 ? 2 : 0) + (CHARTLINK.test(p.text) ? 2 : 0);
    const reach = Math.log10(p.views + p.likes + 1);
    const recency = p.at ? Math.max(0, 1 - (now - p.at) / (365 * 864e5)) : 0;
    return kw * 3 + call + reach + recency * 0.8;
  };
  const ranked = [...all].sort((a, b) => score(b) - score(a)).slice(0, 70);
  const newest = [...originals].sort((a, b) => (b.at ?? 0) - (a.at ?? 0)).slice(0, 12);
  const rankedKeys = new Set(ranked.map((p) => p.text.slice(0, 80).toLowerCase()));
  for (const p of newest) if (!rankedKeys.has(p.text.slice(0, 80).toLowerCase())) ranked.push(p);
  return {
    posts: ranked.map(stamp),
    newest: newest.map((p) => p.text),
    count: { originals: originals.length, searched: searched.length, ranked: ranked.length }
  };
}
async function getLastPostAt(handle) {
  const key = env("TWITTERAPI_KEY");
  if (!key) return null;
  const u = handle.replace(/^@/, "");
  try {
    const res = await twFetch(`${TWITTERAPI}/twitter/user/last_tweets?userName=${encodeURIComponent(u)}`, key);
    if (!res || !res.ok) return null;
    const d = await res.json();
    const tweets = d.data?.tweets ?? d.tweets ?? (Array.isArray(d.data) ? d.data : []);
    const times = tweets.map((t) => Date.parse(t.createdAt ?? t.created_at ?? "")).filter((n) => Number.isFinite(n));
    if (!times.length) return null;
    return new Date(Math.max(...times)).toISOString();
  } catch {
    return null;
  }
}
async function followsSubject(endorser, subject) {
  const rel = await checkFollow(endorser, subject);
  return rel ? rel.following : null;
}
async function checkFollow(source2, target) {
  const key = env("TWITTERAPI_KEY");
  if (!key) return null;
  const s = source2.replace(/^@/, "");
  const t = target.replace(/^@/, "");
  try {
    const res = await twFetch(`${TWITTERAPI}/twitter/user/check_follow_relationship?source_user_name=${encodeURIComponent(s)}&target_user_name=${encodeURIComponent(t)}`, key);
    if (!res || !res.ok) return null;
    const d = asRecord2(await res.json());
    if (twitterProviderFailure(d)) return null;
    const nested = asRecord2(d.data);
    const records = Object.keys(nested).length ? [nested, d] : [d];
    const pick = (...keys) => {
      for (const record2 of records) {
        for (const k of keys) if (typeof record2[k] === "boolean") return record2[k];
      }
      return null;
    };
    const following = pick("following", "is_following", "isFollowing", "follows", "source_following_target");
    const followedBy = pick("followed_by", "is_followed_by", "isFollowedBy", "followed", "target_following_source");
    if (following === null && followedBy === null) {
      console.log("[check-follow] unrecognized success shape:", JSON.stringify(d).slice(0, 200));
      return null;
    }
    return { following, followedBy };
  } catch {
    return null;
  }
}
async function dynamicNotable(organizationId) {
  const org = organizationId?.trim();
  if (!org) return [];
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SERVICE_KEY");
  if (!url || !key) return [];
  try {
    const r = await fetch(`${url.replace(/\/$/, "")}/rest/v1/reports?select=ref,score&organization_id=eq.${encodeURIComponent(org)}&kind=eq.person&verdict=eq.PASS&order=score.desc&limit=600`, {
      headers: { apikey: key, ...!key.startsWith("sb_secret_") ? { authorization: `Bearer ${key}` } : {} },
      signal: AbortSignal.timeout(8e3)
    });
    if (!r.ok) return [];
    const rows = await r.json();
    const accts = rows.filter((x) => x && typeof x.ref === "string" && /^@?[A-Za-z0-9_]{2,30}$/.test(x.ref)).map((x) => ({ handle: x.ref.replace(/^@/, ""), label: "ARGUS-verified" }));
    return accts;
  } catch {
    return [];
  }
}
async function notableFollowers(subject, opts) {
  const key = env("TWITTERAPI_KEY");
  if (!key) return { list: [], checked: 0, coverage: "unavailable" };
  const subj = subject.replace(/^@/, "").toLowerCase();
  const seen = /* @__PURE__ */ new Set();
  const candidates = [...NOTABLE_ACCOUNTS, ...await dynamicNotable(opts?.organizationId)].filter((n) => {
    const lk = n.handle.toLowerCase();
    if (lk === subj || seen.has(lk)) return false;
    seen.add(lk);
    return true;
  });
  const total = candidates.length;
  const fc = opts?.followerCount ?? Infinity;
  const enumPages = Math.ceil(fc / 200);
  if (Number.isFinite(fc) && enumPages <= Math.min(total, 150)) {
    const set = new Map(candidates.map((n) => [n.handle.toLowerCase(), n]));
    const hits2 = [];
    const got = /* @__PURE__ */ new Set();
    const u = subject.replace(/^@/, "");
    let cursor = "";
    let observedFollowers = 0;
    let observedPage = false;
    let coverageComplete = false;
    for (let page = 0; page < enumPages + 2; page++) {
      const url = `${TWITTERAPI}/twitter/user/followers?userName=${encodeURIComponent(u)}&pageSize=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const res = await twFetch(url, key);
      if (!res || !res.ok) break;
      let d;
      try {
        d = asRecord2(await res.json());
      } catch {
        break;
      }
      if (twitterProviderFailure(d)) break;
      const nested = asRecord2(d.data);
      const followerValue = Array.isArray(d.followers) ? d.followers : Array.isArray(nested.followers) ? nested.followers : null;
      if (!followerValue) break;
      const followers = followerValue;
      observedPage = true;
      observedFollowers += followers.length;
      for (const follower of followers) {
        const f = asRecord2(follower);
        const h = String(f.userName ?? f.screen_name ?? "").toLowerCase();
        const m = set.get(h);
        if (m && !got.has(h)) {
          got.add(h);
          hits2.push({ handle: m.handle, label: m.label, size: "" });
        }
      }
      const hasNextPage = typeof d.has_next_page === "boolean" ? d.has_next_page : typeof nested.has_next_page === "boolean" ? nested.has_next_page : void 0;
      const nextCursorValue = d.next_cursor ?? nested.next_cursor;
      const nextCursor = typeof nextCursorValue === "string" ? nextCursorValue : "";
      if (hasNextPage === false || hasNextPage === void 0 && observedFollowers >= fc) {
        coverageComplete = true;
        break;
      }
      if (!hasNextPage || !nextCursor) break;
      cursor = nextCursor;
    }
    return {
      list: hits2,
      checked: coverageComplete ? total : hits2.length,
      coverage: coverageComplete ? "complete" : observedPage ? "partial" : "unavailable"
    };
  }
  const REVERSE_CAP = 500;
  const toCheck = candidates.slice(0, REVERSE_CAP);
  const hits = [];
  const CHUNK = 15;
  const deadline = Date.now() + (opts?.budgetMs ?? 45e3);
  let checked = 0;
  for (let i = 0; i < toCheck.length; i += CHUNK) {
    if (Date.now() > deadline) break;
    const slice = toCheck.slice(i, i + CHUNK);
    const res = await Promise.all(
      slice.map(async (n) => {
        const rel = await checkFollow(n.handle, subject);
        return { notable: n, rel };
      })
    );
    let observedInChunk = 0;
    for (const { notable, rel } of res) {
      if (!rel || rel.following === null) continue;
      observedInChunk += 1;
      checked += 1;
      if (rel.following) hits.push({ handle: notable.handle, label: notable.label, size: "" });
    }
    if (observedInChunk === 0) break;
  }
  return {
    list: hits,
    checked,
    coverage: toCheck.length === total && checked === toCheck.length && toCheck.length > 0 ? "complete" : checked > 0 ? "partial" : "unavailable"
  };
}
async function acknowledgments(endorsers, subject) {
  const out = /* @__PURE__ */ new Map();
  const key = env("XAI_API_KEY");
  const list = [...new Set(endorsers.map((e) => e.replace(/^@/, "")).filter(Boolean))];
  if (!key || !list.length) return out;
  const s = subject.replace(/^@/, "");
  const system = "You generate endorsement-verification leads for a due-diligence collector, with live web and X search. For EACH listed account, surface the strongest candidate public acknowledgment that account may have made of @" + s + ' on X, its sentiment, and the exact post URL. This is discovery only: do not call a relationship corroborated or contradicted. Without a direct post URL, return ack=none and sentiment=none. ack is one of none|mention|thanks|endorsement; sentiment is positive|neutral|negative|none. Reply with ONLY compact JSON: {"results":[{"handle":"@...","ack":"none|mention|thanks|endorsement","sentiment":"positive|neutral|negative|none","source_url":"https://x.com/.../status/..."}]}. Provide one entry per listed account and never invent posts.';
  const text2 = await grokSearch(system, `Accounts to check: ${list.map((e) => "@" + e).join(", ")}. For each: has it ever publicly acknowledged @${s} on X? Search each account's posts.`, { maxToolCalls: Math.min(6, list.length + 1), cacheKey: `ack:${s}:${[...list].sort().join(",")}` });
  if (!text2) return out;
  const m = text2.match(/\{[\s\S]*\}/);
  if (!m) return out;
  try {
    const arr = JSON.parse(m[0]).results ?? [];
    for (const r of arr) {
      const h = typeof r?.handle === "string" ? r.handle.replace(/^@/, "").toLowerCase() : "";
      if (!h) continue;
      const sourceUrl = typeof r?.source_url === "string" && /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]+\/status\/\d+/i.test(r.source_url) ? r.source_url : void 0;
      out.set(h, {
        ack: sourceUrl && ["mention", "thanks", "endorsement"].includes(r.ack) ? r.ack : "none",
        sentiment: sourceUrl && ["positive", "neutral", "negative"].includes(r.sentiment) ? r.sentiment : "none",
        source_url: sourceUrl
      });
    }
  } catch {
  }
  return out;
}
async function discoverAffiliations(handle, name, oldHandles = []) {
  const h = handle.replace(/^@/, "");
  const aliasLine = oldHandles.length ? ` This SAME person previously used these X handles: ${oldHandles.map((o) => "@" + o).join(", ")}. Search posts mentioning those old handles too.` : "";
  const system = `You are a forensic due-diligence researcher with live web and X search. Find EVERY company, crypto project, fund, DAO, or venture that THIS SPECIFIC person (the holder of the given X account) is publicly tied to in ANY working capacity: founded, co-founded, led, was an early employee of, worked at, contributed to, was a core team member of, or advised. Work BOTH angles: (1) what the person's own footprint shows, including accelerator/portfolio pages, press, team pages, GitHub orgs, podcasts, and Crunchbase beyond their bio and LinkedIn; (2) reverse mentions from project/company accounts that ever NAMED, TAGGED, or ANNOUNCED this person as a founder/team member (co-founder announcements and 'meet the team' posts are often YEARS old, on the project's timeline, so search historical posts). There MUST be public evidence tying THAT EXACT person to the venture. For each, also report the venture's own X handle and website domain if you can find them. Reply with ONLY compact JSON: {"affiliations":[{"name":"","role":"founder|cofounder|exec|employee|engineer|contributor|advisor|affiliate","year":"","evidence":"one short source phrase","x_handle":"@...","domain":"example.com"}]}. Include ONLY affiliations you found real, attributable evidence for. If you cannot confidently tie a venture to THIS person, omit it. If you find nothing, return {"affiliations":[]}. NEVER invent, guess, or include a venture just because the name is common. Never use em dashes.`;
  const text2 = await grokSearch(system, `Person: ${name || h} (X handle @${h}).${aliasLine} Find every company or project they have founded, led, worked at, contributed to, or advised, however small the role. Use their own footprint AND project accounts announcing them. Be exhaustive: a serial operator often has 5-15 ventures across years; keep searching until you have run down every lead. Search the web and X including historical posts.`, { maxToolCalls: 10, cacheKey: `affil:${h}:${oldHandles.join(",")}` });
  if (!text2) return [];
  const m = text2.match(/\{[\s\S]*\}/);
  if (!m) return [];
  try {
    const parsed = JSON.parse(m[0]);
    const out = Array.isArray(parsed.affiliations) ? parsed.affiliations : Array.isArray(parsed.ventures) ? parsed.ventures : [];
    return out.filter((v) => v && typeof v.name === "string" && v.name.trim()).map((v) => ({
      name: v.name.trim(),
      role: v.role || "affiliate",
      year: v.year,
      evidence: v.evidence,
      x_handle: v.x_handle && /^@?[A-Za-z0-9_]{2,30}$/.test(v.x_handle) ? "@" + v.x_handle.replace(/^@/, "") : void 0,
      domain: v.domain && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v.domain) ? v.domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "") : void 0
    })).slice(0, 10);
  } catch {
    return [];
  }
}
async function findTeam(handle, name, posts = []) {
  const h = handle.replace(/^@/, "");
  const postContext = posts.length ? `

The account's recent posts (mine these for team intros / role + advisor announcements):
${posts.slice(0, 15).map((p, i) => `${i + 1}. ${p}`).join("\n")}` : "";
  const system = `You are a forensic researcher with live X search. Identify the PEOPLE publicly tied to the project behind the given X account: founders, cofounders, core team, engineers, AND advisors/backers. Look especially at the account's OWN posts (team intros, 'welcome @x as our CTO', 'our founder @y', 'advised by @z', 'backed by @w') and posts that tag these people, plus posts mentioning the project that name its people. Be PRECISE about each person's role AT THIS project: only call someone an advisor if they are actually named as one; if they are a founder/cofounder, say so. Do NOT downgrade a founder to advisor. For EACH person also list their OTHER notable projects or companies (name + their role there, e.g. founder/cofounder/advisor/engineer) that live web/X search reveals. This exposes serial founders and cross-project ties. Include ONLY people with real public evidence tying them to THIS project. EXCLUDE the project account itself, generic shillers, hype repliers, and unrelated mentions. Reply with ONLY compact JSON: {"people":[{"name":"","handle":"@...","linkedin":"linkedin.com/in/...","role":"founder|cofounder|ceo|cto|engineer|advisor|backer","kind":"team|advisor","evidence":"","projects":[{"name":"","role":""}]}]}. If none, return {"people":[]}. NEVER invent. Never use em dashes.`;
  const text2 = await grokSearch(system, `X account: @${h}${name && name !== h ? ` (${name})` : ""}. Who are the founders, team members, and advisors of this project? Give each person's precise role here AND their other projects. Search the account's own posts and posts mentioning it.${postContext}`, { cacheKey: `team-x:${h}` });
  return parseTeamJSON(text2, h, "X content");
}
async function findTeamOnSite(domain, projectName2) {
  const clean4 = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
  if (!clean4 && !projectName2) return [];
  const anchor = clean4 ? `website ${clean4}${projectName2 ? ` (${projectName2})` : ""}` : `project "${projectName2}"`;
  const system = `You are a forensic OSINT researcher with live web and X search. Find EVERY real person behind the crypto/tech project: founders, cofounders, the WHOLE leadership team (CEO/CTO/COO/CFO/CMO), engineering and product leads, AND advisors/backers. DIG hard and be COMPLETE: Google the project + 'team'/'leadership'/'about', open the project's LinkedIn company page and read its 'People' tab (list the employees it shows), check Crunchbase people, the GitHub org's members, podcasts/interviews/press, and X. For an established project expect to name SEVERAL people. Do NOT stop at one or two; keep going until you have the full public roster you can verify. Connect each name to their X handle and LinkedIn where possible. Include ONLY real people genuinely tied to THIS specific project (match the domain/name; do not confuse same-named projects). EXCLUDE hype/shill accounts and generic mentions. Be PRECISE about each person's role AT THIS project: only call someone an advisor if the project actually names them as one; if the site/LinkedIn shows them as a founder/cofounder/CEO, use THAT. Do NOT downgrade a founder to advisor. For EACH person, also list their OTHER notable projects/companies (name + their role there) that web/LinkedIn/Crunchbase reveal. This exposes serial founders and cross-project ties. Reply with ONLY compact JSON: {"people":[{"name":"","handle":"@...","linkedin":"linkedin.com/in/...","role":"","kind":"team|advisor","evidence":"","projects":[{"name":"","role":""}]}]}. If nobody, {"people":[]}. NEVER invent. Never use em dashes.`;
  const text2 = await grokSearch(system, `Crypto/tech ${anchor}. Find the COMPLETE public team: every founder, executive, core team member, and advisor behind it. Read its LinkedIn company People tab, Crunchbase, GitHub org, and press. Connect each to their X handle and LinkedIn, give each person's PRECISE role here, AND list their other projects. Name as many verifiable people as you can, not just the most famous one.`, { cacheKey: `team-site:${clean4 || projectName2}` });
  return parseTeamJSON(text2, void 0, clean4 ? "web/LinkedIn search" : "web/LinkedIn (by name)");
}
async function enrichTeamIdentities(project, people) {
  if (!people.length) return [];
  const system = `You are an OSINT researcher with live web and X search. For each named team member of the given project, find their X (Twitter) handle and LinkedIn profile. Match the RIGHT person: same name + same project/role (check bios, the project's follows, press). If you cannot confidently match one, omit that field rather than guess. Reply with ONLY compact JSON: {"people":[{"name":"","handle":"@...","linkedin":"linkedin.com/in/..."}]}. Provide one entry per input name, with fields omitted when unknown. NEVER invent. Never use em dashes.`;
  const list = people.map((p) => `${p.name}${p.role ? ` (${p.role})` : ""}`).join("; ");
  const text2 = await grokSearch(system, `Project: ${project}. Team members to resolve: ${list}. Find each person's X handle and LinkedIn.`, { cacheKey: `enrich:${project}:${people.map((p) => p.name).sort().join("|")}` });
  if (!text2) return [];
  const m = text2.match(/\{[\s\S]*\}/);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]).people ?? [];
    return arr.filter((p) => p && typeof p.name === "string" && p.name.trim()).map((p) => ({
      name: p.name.trim(),
      handle: typeof p.handle === "string" && /^@?[A-Za-z0-9_]{2,30}$/.test(p.handle.replace(/^@/, "")) ? "@" + p.handle.replace(/^@/, "") : void 0,
      linkedin: typeof p.linkedin === "string" && /linkedin\.com\/(in|company)\//i.test(p.linkedin) ? p.linkedin.replace(/^https?:\/\//, "").replace(/\/$/, "") : void 0
    }));
  } catch {
    return [];
  }
}
var ROLE_SOURCE = "co-?founders?|founders?|ceo|cto|coo|cfo|cmo|chief\\s+\\w+\\s+officer|lead\\s+(?:dev|developer|engineer)|core\\s+(?:dev|team)|head\\s+of\\s+\\w+|advisors?|team\\s+members?|our\\s+(?:founder|ceo|cto|coo|team|dev|lead)";
var regexEscape2 = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function scanPostsForRoles(posts, projectName2) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (m) => {
    const k = (m.handle ?? m.name).toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(m);
  };
  const project = projectName2?.trim() ? regexEscape2(projectName2.trim()) : "";
  const roleIsProjectOwned = (post, index, length, role) => {
    const window = post.slice(Math.max(0, index - 56), Math.min(post.length, index + length + 56));
    const r = regexEscape2(role).replace(/\\ /g, "\\s+");
    const owner = project ? `(?:our|${project})` : "our";
    return new RegExp(`\\b${owner}\\s+(?:own\\s+|core\\s+)?${r}\\b|\\b${r}\\s+(?:at|for)\\s+${owner}\\b`, "i").test(window);
  };
  for (const raw of posts.slice(0, 80)) {
    const p = String(raw ?? "");
    const before = new RegExp(`@([A-Za-z0-9_]{2,30})[^@\\n.!?]{0,32}\\b(${ROLE_SOURCE})\\b`, "gi");
    for (const match of p.matchAll(before)) {
      const role = match[2].toLowerCase().replace(/^our\s+/, "");
      if (!roleIsProjectOwned(p, match.index, match[0].length, role)) continue;
      const kind = /advisor/i.test(role) ? "advisor" : "team";
      add({ name: `@${match[1]}`, handle: `@${match[1]}`, role, kind, evidence: `the official account placed @${match[1]} next to the role "${role}"`, source: "post role-scan" });
    }
    const after = new RegExp(`\\b(${ROLE_SOURCE})\\b(?!\\s+of\\b)[^@\\n.!?]{0,24}@([A-Za-z0-9_]{2,30})`, "gi");
    for (const match of p.matchAll(after)) {
      const role = match[1].toLowerCase().replace(/^our\s+/, "");
      if (!roleIsProjectOwned(p, match.index, match[0].length, role)) continue;
      const kind = /advisor/i.test(role) ? "advisor" : "team";
      add({ name: `@${match[2]}`, handle: `@${match[2]}`, role, kind, evidence: `the official account placed the role "${role}" next to @${match[2]}`, source: "post role-scan" });
    }
    const roster = new RegExp(`((?:@[A-Za-z0-9_]{2,30}[\\s,]*(?:and\\s+)?){1,4})(?:and\\s+other\\s+)?members?\\s+of\\s+(?:the\\s+)?[^\\n.!?]{0,32}?team\\b`, "gi");
    for (const match of p.matchAll(roster)) {
      const rosterOwner = project ? new RegExp(`members?\\s+of\\s+(?:the\\s+)?(?:our|${project})\\s+team\\b`, "i") : /members?\s+of\s+(?:the\s+)?our\s+team\b/i;
      if (!rosterOwner.test(match[0])) continue;
      for (const handle of match[1].matchAll(/@([A-Za-z0-9_]{2,30})/g)) {
        add({ name: `@${handle[1]}`, handle: `@${handle[1]}`, role: "team member", kind: "team", evidence: `the official account named @${handle[1]} as a project team member`, source: "post role-scan" });
      }
    }
  }
  return out.slice(0, 12);
}
function parseTeamJSON(text2, selfHandle, source2) {
  if (!text2) return [];
  const m = text2.match(/\{[\s\S]*\}/);
  if (!m) return [];
  try {
    const parsed = JSON.parse(m[0]);
    const arr = Array.isArray(parsed.people) ? parsed.people : Array.isArray(parsed.team) ? parsed.team : [];
    const self = (selfHandle ?? "").replace(/^@/, "").toLowerCase();
    return arr.filter((t) => t && typeof t.name === "string" && t.name.trim()).map((t) => {
      const role = (t.role || "team").toString();
      const kind = t.kind === "advisor" || /advisor|advis|backer|mentor/i.test(role) ? "advisor" : "team";
      const linkedin = typeof t.linkedin === "string" && /linkedin\.com\/(in|company)\//i.test(t.linkedin) ? t.linkedin.replace(/^https?:\/\//, "").replace(/\/$/, "") : void 0;
      const projects = Array.isArray(t.projects) ? t.projects.filter((p) => p && typeof p.name === "string" && p.name.trim()).map((p) => ({ name: p.name.trim().slice(0, 60), role: typeof p.role === "string" && p.role.trim() ? p.role.trim().slice(0, 40) : void 0 })).slice(0, 6) : void 0;
      return {
        name: t.name.trim(),
        handle: t.handle && /^@?[A-Za-z0-9_]{2,30}$/.test(t.handle) ? "@" + t.handle.replace(/^@/, "") : void 0,
        role,
        kind,
        linkedin,
        evidence: typeof t.evidence === "string" ? t.evidence : void 0,
        source: source2,
        projects: projects && projects.length ? projects : void 0
      };
    }).filter((t) => !t.handle || t.handle.replace(/^@/, "").toLowerCase() !== self).slice(0, 16);
  } catch {
    return [];
  }
}
async function searchAdverseSignals(handle, kind, context, ticker) {
  const h = handle.replace(/^@/, "");
  const targetEntityKey = `@${h.toLowerCase()}`;
  const subject = kind === "project" ? `the project / company behind X account @${h}${ticker ? ` (token $${ticker.replace(/^\$/, "")})` : ""}` : `the person behind X account @${h}`;
  const system = `You are a forensic due-diligence researcher with live web and X search. Search for ADVERSE signals about the named subject: accusations of a rug pull, slow rug, liquidity pull/removal, wallet draining, exit scam, or general community complaints/FUD. Search X, Trustpilot/review sites, Reddit, and scam-report sites. Run BOTH '<subject> scam', '<subject> rug', and '<subject> fud'-style queries. Return candidate leads only. For EACH, provide the one specific page or post that an independent collector should fetch and verify. Do not grade credibility, count independent sources, call anything verified, or infer guilt. Do not repeat the subject's own marketing. If there are no sourced leads, return an empty list. Reply with ONLY compact JSON: {"signals":[{"category":"rug|slow_rug|liquidity_pull|drain|scam_accusation|fud","claim":"","source":"","source_url":""}]}. Never use em dashes.`;
  const text2 = await grokSearch(system, `Subject: ${subject}. Surface source URLs that may contain complaints or accusations of rug, slow rug, liquidity pull, wallet drains, exit scam, or FUD. These are leads for later verification, not findings.`);
  if (!text2) return [];
  const m = text2.match(/\{[\s\S]*\}/);
  if (!m) return [];
  try {
    const parsed = JSON.parse(m[0]);
    const cats = /* @__PURE__ */ new Set(["rug", "slow_rug", "liquidity_pull", "drain", "scam_accusation", "fud"]);
    const out = Array.isArray(parsed.signals) ? parsed.signals : [];
    return out.filter((s) => s && typeof s.claim === "string" && s.claim.trim() && cats.has(s.category)).map((s) => ({
      category: s.category,
      claim: s.claim.trim(),
      source: (s.source || "unattributed").toString().trim(),
      source_url: typeof s.source_url === "string" && /^https?:\/\//.test(s.source_url) ? s.source_url : void 0,
      target_entity_key: targetEntityKey,
      target_entity_type: kind,
      relationship_to_subject: context.relationship_to_subject,
      relationship_label: context.relationship_label?.trim() || void 0
    })).slice(0, 12);
  } catch {
    return [];
  }
}
async function detectManipulationTooling(handle, name) {
  const h = handle.replace(/^@/, "");
  const system = `You are a forensic research lead generator with live web and X search. Surface candidate first-party pages that may connect the given person to a token bundler, wallet mixer, volume faker, wash-trading generator, or multi-wallet snipe bot. Return leads for an independent collector to verify; do not decide that the person operates the tool and do not call the connection verified. Prefer the product's own page, docs, or post and include the role claimed on that page. Legitimate general token-creation or analytics tools do not count. Reply with ONLY compact JSON: {"role_claim":"","tools":[{"name":"","kind":"bundler|mixer|volume_faker|snipe_bot|multi_wallet|other","url":"","evidence":""}]}. If none, return {"role_claim":"","tools":[]}. NEVER invent. Never use em dashes.`;
  const text2 = await grokSearch(system, `Person: ${name || h} (X handle @${h}). Find candidate first-party pages that may link them to manipulation tooling. Return URLs for later independent verification only.`);
  if (!text2) return null;
  const m = text2.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[0]);
    const kinds = /* @__PURE__ */ new Set(["bundler", "mixer", "volume_faker", "snipe_bot", "multi_wallet", "other"]);
    const tools = (Array.isArray(parsed.tools) ? parsed.tools : []).filter((t) => t && typeof t.name === "string" && t.name.trim()).map((t) => ({
      name: t.name.trim(),
      kind: kinds.has(t.kind) ? t.kind : "other",
      url: typeof t.url === "string" && /^https?:\/\//.test(t.url) ? t.url : void 0,
      evidence: (t.evidence || "").toString().trim()
    })).slice(0, 8);
    if (!tools.length) return { role_claim: "", tools: [] };
    return { role_claim: (parsed.role_claim || "claimed operator").toString().trim(), tools };
  } catch {
    return null;
  }
}
function fmtFollowers(n) {
  if (n == null) return "N/A";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}
var xAdapter = {
  id: "x",
  label: "X (Grok + twitterapi.io)",
  available: () => !!env("TWITTERAPI_KEY") || !!env("XAI_API_KEY"),
  async run(ctx) {
    const haveProfile = ctx.evidence.profile.followers && ctx.evidence.profile.followers !== "N/A";
    const haveOfficialAvatar = ctx.evidence.profile.avatar_source_state != null;
    const prof = haveProfile && haveOfficialAvatar ? null : await getProfile2(ctx.handle);
    if (prof) {
      ctx.evidence.profile.profile_collection_state = "resolved";
      ctx.evidence.profile.profile_provider = "twitterapi";
      ctx.evidence.profile.profile_captured_at = (/* @__PURE__ */ new Date()).toISOString();
      ctx.evidence.profile.display_name = prof.name ?? ctx.evidence.profile.display_name;
      ctx.evidence.profile.bio = prof.bio ?? ctx.evidence.profile.bio;
      ctx.evidence.profile.website = canonicalPublicProfileWebsite(prof.website) ?? ctx.evidence.profile.website;
      ctx.evidence.profile.followers = fmtFollowers(prof.followers);
      if (prof.image) {
        ctx.evidence.profile.avatar_url = prof.image;
        ctx.evidence.profile.avatar_source_state = "resolved";
      } else {
        ctx.evidence.profile.avatar_source_state = "none";
      }
      if (prof.createdAt) {
        const d = new Date(prof.createdAt);
        if (!isNaN(d.getTime())) {
          ctx.evidence.profile.joined = d.toLocaleString("en-US", { month: "short", year: "numeric" });
        }
      }
      ctx.emit({ phase: "P0 \xB7 Intake", label: "Resolve profile", detail: `${prof.name ?? ctx.handle}, ${fmtFollowers(prof.followers)} followers`, source: "twitterapi.io", tone: "neutral" });
    }
    if (!ctx.evidence.recentActivity.length) {
      const posts = await getRecentPosts(ctx.handle);
      if (posts.length) {
        ctx.evidence.recentActivity = posts;
        ctx.emit({ phase: "P0 \xB7 Intake", label: "Recent activity", detail: `Pulled ${posts.length} recent posts.`, source: "twitterapi.io", tone: "neutral" });
      }
    }
    const lastPostAt = await getLastPostAt(ctx.handle);
    if (lastPostAt) {
      const days = Math.floor((Date.now() - Date.parse(lastPostAt)) / 864e5);
      ctx.evidence.profile.last_post_at = lastPostAt;
      ctx.evidence.profile.days_since_post = days;
      const dormant = days >= 21;
      ctx.emit({ phase: "P0 \xB7 Intake", label: dormant ? "Dormant account" : "Active", detail: dormant ? `No posts in ${days} days. A project or account gone quiet is a liveness flag.` : `Last posted ${days === 0 ? "today" : days === 1 ? "yesterday" : days + " days ago"}.`, source: "twitterapi.io", tone: dormant ? "warn" : "good" });
    }
    if (!ctx.evidence.notableFollowers.length) {
      ctx.emit({ phase: "P0 \xB7 Intake", label: "Notable followers", detail: "Checking which top funds, founders, and KOLs follow the subject\u2026", source: "twitterapi.io", tone: "neutral" });
      const fcm = (ctx.evidence.profile.followers ?? "").match(/([\d.]+)\s*([KMB]?)/i);
      const followerCount = fcm ? Number(fcm[1]) * (/m/i.test(fcm[2]) ? 1e6 : /b/i.test(fcm[2]) ? 1e9 : /k/i.test(fcm[2]) ? 1e3 : 1) : void 0;
      const scan = await notableFollowers(ctx.handle, { followerCount, organizationId: ctx.organizationId });
      const nf = scan.list;
      ctx.evidence.notableFollowers = nf;
      if (nf.length) {
        const coverageDetail = scan.coverage === "complete" ? `Followed by ${nf.length} of ${scan.checked} known accounts checked` : `Observed ${nf.length} notable follower${nf.length === 1 ? "" : "s"} before provider coverage became incomplete`;
        ctx.emit({ phase: "P0 \xB7 Intake", label: scan.coverage === "complete" ? "Notable followers" : "Notable followers \xB7 partial coverage", detail: `${coverageDetail}: ${nf.slice(0, 8).map((n) => `@${n.handle}${n.label ? ` (${n.label})` : ""}`).join(", ")}${nf.length > 8 ? ", \u2026" : ""}.${scan.coverage === "complete" ? "" : " Unobserved relationships remain unknown."}`, source: "twitterapi.io", tone: scan.coverage === "complete" ? "good" : "warn" });
      } else if (scan.coverage === "complete" && scan.checked > 0) {
        ctx.emit({ phase: "P0 \xB7 Intake", label: "Notable followers", detail: `None of the ${scan.checked} known funds/founders/KOLs checked follow this subject.`, source: "twitterapi.io", tone: "neutral" });
      } else if (scan.coverage === "partial") {
        ctx.emit({ phase: "P0 \xB7 Intake", label: "Notable follower check incomplete", detail: scan.checked > 0 ? `No notable follower was observed in ${scan.checked} returned relationship result${scan.checked === 1 ? "" : "s"}; unobserved accounts remain unknown, so ARGUS withheld the negative conclusion.` : "Some follower data returned, but full reference-set coverage was not established; ARGUS withheld the negative conclusion.", source: "twitterapi.io", tone: "warn" });
      } else {
        ctx.emit({ phase: "P0 \xB7 Intake", label: "Notable follower check unavailable", detail: "The relationship provider returned no observable results; ARGUS withheld the notable-follower conclusion.", source: "twitterapi.io", tone: "warn" });
      }
    }
    const claims = [...ctx.evidence.testimonials, ...ctx.evidence.advised].filter((t) => t.claimed_endorser_handle || t.project_handle).slice(0, 6);
    let observedRelationships = 0;
    let adverseRelationships = 0;
    const ackMap = await acknowledgments(claims.map((t) => t.claimed_endorser_handle || t.project_handle), ctx.handle);
    await Promise.all(
      claims.map(async (t) => {
        const endorser = t.claimed_endorser_handle || t.project_handle;
        const follows = await followsSubject(endorser, ctx.handle);
        const ack = ackMap.get(String(endorser).replace(/^@/, "").toLowerCase()) ?? null;
        if (follows !== null) {
          t.follows_subject = follows;
          observedRelationships += 1;
          if (!follows) adverseRelationships += 1;
        }
        if (ack?.source_url) {
          const lead = `Model-search acknowledgment lead: ${ack.ack}, ${ack.sentiment} (${ack.source_url}); independent artifact verification required`;
          t.notes = [t.notes, lead].filter(Boolean).join(" \xB7 ");
        }
        t.corroboration_verdict = classifyTestimonial(t);
        const tone = t.corroboration_verdict === "Contradicted" /* CONTRADICTED */ ? "bad" : t.corroboration_verdict === "Corroborated" /* CORROBORATED */ ? "good" : "warn";
        ctx.emit({ phase: "Corroborate", label: `${endorser}`, detail: `${t.claimed_relationship ?? "endorser"}: ${t.corroboration_verdict}${follows === false ? " \xB7 does not follow subject" : ""}`, source: "X", tone });
      })
    );
    if (observedRelationships) {
      ctx.recordCheck?.({
        id: "affiliations-associates",
        status: adverseRelationships ? "finding" : "confirmed",
        note: `${observedRelationships} claimed relationship${observedRelationships === 1 ? "" : "s"} checked in the X follow graph${adverseRelationships ? ` \xB7 ${adverseRelationships} did not follow the subject` : ""}`,
        provider: "twitterapi.io",
        sourceCount: observedRelationships
      });
    }
  }
};

// server/adapters/teampage.ts
function candidateUrls(domain) {
  const d = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
  if (!d) return [];
  const paths = ["team", "about", "about-us", "team-members", "our-team", "company", "people", "leadership"];
  const urls = [];
  for (const host of [d, `docs.${d}`, `www.${d}`]) {
    for (const p of paths) {
      urls.push(`https://${host}/${p}`);
      urls.push(`https://${host}/${p}.md`);
    }
  }
  return urls;
}
var TEAM_DOCUMENT_HINT = /(?:^|[\/_-])(team|leadership|founders?|people|company|about(?:-us)?|tokenomics|governance|transparency|contributors?)(?:[\/_\-.]|$)/i;
function teamDocumentUrlsFromIndex(domain, raw) {
  const apex = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
  if (!apex || !raw) return [];
  const matches = raw.match(/https?:\/\/[^\s<>"'\])}]+/gi) ?? [];
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const value of matches) {
    try {
      const url = new URL(value.replace(/&amp;/g, "&").replace(/[.,;:]+$/, ""));
      const host = url.hostname.toLowerCase();
      if (host !== apex && !host.endsWith(`.${apex}`)) continue;
      if (!TEAM_DOCUMENT_HINT.test(`${url.hostname}${url.pathname}`)) continue;
      url.hash = "";
      url.search = "";
      const normalized4 = url.toString();
      if (seen.has(normalized4)) continue;
      seen.add(normalized4);
      out.push(normalized4);
    } catch {
    }
    if (out.length >= 24) break;
  }
  return out;
}
async function discoverTeamDocumentUrls(domain) {
  const d = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
  if (!d) return [];
  const indexes = [
    `https://${d}/llms.txt`,
    `https://${d}/sitemap.xml`,
    `https://docs.${d}/llms.txt`,
    `https://docs.${d}/sitemap.xml`
  ];
  const bodies = await Promise.all(indexes.map(async (url) => {
    try {
      const response = await fetch(url, {
        headers: { "user-agent": "Mozilla/5.0 (compatible; ARGUS/1.0)", accept: "text/plain,application/xml,text/xml" },
        redirect: "follow",
        signal: AbortSignal.timeout(8e3)
      });
      if (!response.ok) {
        recordCall("site-fetch", "team-doc-index", 0, `http_${response.status}`, "failed");
        return "";
      }
      const text2 = await response.text();
      recordCall("site-fetch", "team-doc-index", 0, void 0, "succeeded");
      return text2.slice(0, 25e4);
    } catch {
      recordCall("site-fetch", "team-doc-index", 0, "transport_error", "failed");
      return "";
    }
  }));
  return [...new Set(bodies.flatMap((body) => teamDocumentUrlsFromIndex(d, body)))];
}
function htmlToText(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
}
async function fetchPage(url) {
  let response;
  try {
    response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; ARGUS/1.0)", accept: "text/html,text/markdown,text/plain" }, redirect: "follow", signal: AbortSignal.timeout(8e3) });
  } catch {
    recordCall("site-fetch", "team-page", 0, "transport_error", "failed");
    return null;
  }
  if (!response.ok) {
    recordCall("site-fetch", "team-page", 0, `http_${response.status}`, "failed");
    return null;
  }
  const ct = response.headers.get("content-type") ?? "";
  if (!/html|markdown|text\/plain/i.test(ct)) {
    recordCall("site-fetch", "team-page", 0, "unexpected_content_type", "partial");
    return null;
  }
  let raw;
  try {
    raw = await response.text();
  } catch {
    recordCall("site-fetch", "team-page", 0, "response_text_error", "failed");
    return null;
  }
  const text2 = /markdown|text\/plain/i.test(ct) || url.endsWith(".md") ? raw.replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\s+/g, " ").trim() : htmlToText(raw);
  if (text2.length < 300 || !/founder|ceo|cto|team|advisor|lead|head of|engineer|officer/i.test(text2)) {
    recordCall("site-fetch", "team-page", 0, "insufficient_team_content", "partial");
    return null;
  }
  recordCall("site-fetch", "team-page", 0, void 0, "succeeded");
  return { url, text: text2 };
}
var roleEvidencePattern = (role) => {
  if (/founder/i.test(role)) return /\b(?:co-?founders?|founders?|started|founded)\b/i;
  if (/\bcto\b|technology/i.test(role)) return /\b(?:cto|chief technology officer)\b/i;
  if (/\bceo\b|executive/i.test(role)) return /\b(?:ceo|chief executive officer)\b/i;
  if (/advisor|adviser/i.test(role)) return /\b(?:advisor|adviser)\b/i;
  if (/engineer|developer/i.test(role)) return /\b(?:engineer|developer|dev)\b/i;
  if (/lead|head|chief/i.test(role)) return /\b(?:lead|head of|chief)\b/i;
  return /\b(?:team|core team|contributor)\b/i;
};
function teamMemberIsDirectlySupported(text2, name, handle, role, projectName2) {
  const corpus = text2.replace(/\s+/g, " ");
  const identities = [name, handle?.replace(/^@/, "")].filter((value) => Boolean(value?.trim())).map((value) => value.trim().toLowerCase());
  const lower = corpus.toLowerCase();
  const rolePattern = roleEvidencePattern(role);
  for (const identity of identities) {
    let offset = lower.indexOf(identity);
    while (offset >= 0) {
      const window = corpus.slice(Math.max(0, offset - 220), Math.min(corpus.length, offset + identity.length + 220));
      if (rolePattern.test(window) && (!projectName2 || window.toLowerCase().includes(projectName2.toLowerCase()))) return true;
      offset = lower.indexOf(identity, offset + identity.length);
    }
  }
  return false;
}
var canonicalSourceUrl = (value) => {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
};
var pageScore = (page) => (/\/(?:team|leadership|founders?|people)(?:[/.?#-]|$)/i.test(page.url) ? 100 : 0) + (/\b(?:co-?founders?|founders?)\b/i.test(page.text) ? 70 : 0) + (/\/(?:tokenomics|governance|transparency)(?:[/.?#-]|$)/i.test(page.url) ? 35 : 0) + Math.min(20, page.text.length / 1e3);
var TEAM_EXTRACTION_SYSTEM = "You extract a crypto/tech project's team roster from fetched first-party project text. List EVERY named person with a role: founders, executives (CEO/CTO/COO/CFO/CMO), core team, engineering/product leads, and named advisors. Use the exact role the page states. Capture any X/Twitter handle and LinkedIn URL shown next to a person. For every person copy the exact PAGE URL that directly states that person's role. Do NOT invent people or roles; include only names actually present in the text. Never use em dashes.";
var TEAM_EXTRACTION_TOOL = {
  name: "record_team",
  description: "Record named project people whose roles are directly stated in fetched first-party text.",
  input_schema: {
    type: "object",
    properties: {
      people: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            role: { type: "string" },
            twitter: { type: "string", description: "@handle if shown" },
            linkedin: { type: "string", description: "linkedin.com/in/... if shown" },
            source_url: { type: "string", description: "Exact PAGE URL from the supplied corpus that directly states this role" }
          },
          required: ["name", "role", "source_url"]
        }
      }
    },
    required: ["people"]
  }
};
async function extractTeamFromPages(pages, projectName2, requireProjectInPassage = false) {
  if (!pages.length) return [];
  const selectedPages = [...pages].sort((a, b) => pageScore(b) - pageScore(a) || b.text.length - a.text.length).slice(0, 3);
  const corpus = selectedPages.map((page) => `PAGE ${page.url}:
${page.text.slice(0, 5e3)}`).join("\n\n");
  const out = await structured(
    TEAM_EXTRACTION_SYSTEM,
    `Project${projectName2 ? ` ${projectName2}` : ""} first-party team evidence:

${corpus}`,
    TEAM_EXTRACTION_TOOL,
    2048
  );
  if (!out?.people?.length) return [];
  return out.people.filter((person) => person.name && person.name.trim()).flatMap((person) => {
    const rawName = person.name.trim();
    const displayName = /^[a-z][a-z'-]{1,30}$/.test(rawName) ? rawName[0].toUpperCase() + rawName.slice(1) : rawName;
    const role = (person.role || "team").toString();
    const kind = /advisor|advis|backer|mentor/i.test(role) ? "advisor" : "team";
    const handle = person.twitter && /^@?[A-Za-z0-9_]{2,30}$/.test(person.twitter.replace(/^@/, "")) ? "@" + person.twitter.replace(/^@/, "") : void 0;
    const linkedin = person.linkedin && /linkedin\.com\/(in|company)\//i.test(person.linkedin) ? person.linkedin.replace(/^https?:\/\//, "").replace(/\/$/, "") : void 0;
    const claimedSource = canonicalSourceUrl(person.source_url);
    const sourcePage = selectedPages.find((page) => canonicalSourceUrl(page.url) === claimedSource);
    if (!sourcePage || !teamMemberIsDirectlySupported(
      sourcePage.text,
      displayName,
      handle,
      role,
      requireProjectInPassage ? projectName2 : void 0
    )) return [];
    return [{
      name: displayName,
      handle,
      role,
      kind,
      linkedin,
      evidence: `direct role statement on ${sourcePage.url}`,
      source: sourcePage.url,
      sourceUrl: sourcePage.url
    }];
  });
}
async function discoverFounderAuthoredForumUrls(domain, verifiedTeam) {
  const apex = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
  if (!apex || !verifiedTeam.length) return [];
  const verifiedAuthors = new Set(verifiedTeam.flatMap((person) => [person.name, person.handle?.replace(/^@/, "")]).filter((value) => Boolean(value?.trim())).map((value) => value.trim().toLowerCase()));
  const searches = ["cofounder", "co-founder"];
  const hosts = [`discuss.${apex}`, `forum.${apex}`];
  const results = await Promise.all(hosts.flatMap((host) => searches.map(async (query) => {
    try {
      const response = await fetch(`https://${host}/search.json?q=${encodeURIComponent(query)}`, {
        headers: { "user-agent": "Mozilla/5.0 (compatible; ARGUS/1.0)", accept: "application/json" },
        redirect: "follow",
        signal: AbortSignal.timeout(8e3)
      });
      if (!response.ok) return [];
      const payload = await response.json();
      const slugs = new Map((payload.topics ?? []).filter((topic) => Number.isInteger(topic.id) && typeof topic.slug === "string" && topic.slug).map((topic) => [topic.id, topic.slug]));
      return (payload.posts ?? []).flatMap((post) => {
        const authorNames = [post.username, post.name].filter((value) => Boolean(value?.trim())).map((value) => value.trim().toLowerCase());
        const slug = slugs.get(post.topic_id ?? -1);
        if (!authorNames.some((author) => verifiedAuthors.has(author)) || !slug || !Number.isInteger(post.post_number)) return [];
        return [`https://${host}/t/${slug}/${post.topic_id}/${post.post_number}`];
      });
    } catch {
      return [];
    }
  })));
  return [...new Set(results.flat())].slice(0, 8);
}
async function fetchTeamPage(domain, projectName2) {
  const urls = [.../* @__PURE__ */ new Set([
    ...await discoverTeamDocumentUrls(domain),
    ...candidateUrls(domain)
  ])];
  if (!urls.length) return [];
  const pages = (await Promise.all(urls.map(fetchPage))).filter(Boolean);
  if (!pages.length) return [];
  const directTeam = await extractTeamFromPages(pages, projectName2);
  const forumUrls = await discoverFounderAuthoredForumUrls(domain, directTeam);
  const forumPages = (await Promise.all(forumUrls.map(fetchPage))).filter(Boolean);
  const forumTeam = await extractTeamFromPages(forumPages, projectName2, true);
  const seen = /* @__PURE__ */ new Set();
  return [...directTeam, ...forumTeam].filter((person) => {
    const key = (person.handle ?? person.name).replace(/^@/, "").trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// server/adapters/sitecheck.ts
var COMING = /coming[\s_-]*soon|under[\s_-]*construction|launching[\s_-]*soon|join[\s_-]*(the[\s_-]*)?waitlist|\bwaitlist\b|early[\s_-]*access|get[\s_-]*notified|notify[\s_-]*me|be[\s_-]*the[\s_-]*first|request[\s_-]*access|sign[\s_-]*up[\s_-]*for[\s_-]*(early[\s_-]*)?access/i;
var HARD_COMING = /coming[\s_-]*soon|under[\s_-]*construction|launching[\s_-]*soon/i;
var PARKED = /this[\s_-]*domain[\s_-]*is[\s_-]*for[\s_-]*sale|buy[\s_-]*this[\s_-]*domain|hugedomains|sedoparking|parkingcrew|domain[\s_-]*(is[\s_-]*)?parked/i;
var PRODUCT = /\b(docs|whitepaper|dashboard|pricing|features|roadmap|marketplace|explorer|portfolio|order\s*book|connect\s*wallet|launch\s*app|sign\s*in|log\s*in|deposit|withdraw|governance|staking)\b/i;
var ANTI_BOT = /cf-chl-|challenge-platform|just a moment(?:\.{3})?|checking (?:your )?browser(?: before accessing)?|verify (?:that )?you are human|captcha-delivery|_pxcaptcha|perimeterx|datadome|incapsula|akamai bot manager|bot verification/i;
var DNS_CODES = /* @__PURE__ */ new Set(["ENOTFOUND", "EAI_AGAIN", "EAI_FAIL", "ENODATA", "ENONAME"]);
function stripText(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}
function errorCode(error) {
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const candidate = current;
    if (typeof candidate.code === "string") return candidate.code.toUpperCase();
    current = candidate.cause;
  }
  return void 0;
}
function hostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
function isAntiBotResponse(response, body) {
  const mitigation = response.headers.get("cf-mitigated") ?? "";
  const challenge = response.headers.get("x-datadome") ?? response.headers.get("x-captcha") ?? "";
  return /challenge|captcha/i.test(`${mitigation} ${challenge}`) || ANTI_BOT.test(body);
}
async function get(url, opts) {
  let response;
  try {
    response = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; ARGUS/1.0)",
        accept: "text/html,application/javascript"
      },
      redirect: "follow",
      signal: AbortSignal.timeout(8e3)
    });
  } catch (error) {
    const dns = DNS_CODES.has(errorCode(error) ?? "");
    recordCall("site-fetch", "substance", 0, dns ? "dns_error" : "transport_error", "failed");
    return {
      kind: "failure",
      url,
      status: "unreachable",
      reason: dns ? "dns" : "transport",
      detail: dns ? `DNS resolution failed for ${hostname(url)}` : `the request to ${hostname(url)} failed at the transport layer`
    };
  }
  let html;
  try {
    html = await response.text();
  } catch {
    recordCall("site-fetch", "substance", 0, "response_text_error", "failed");
    return {
      kind: "failure",
      url: response.url || url,
      status: "unavailable",
      reason: "content",
      detail: `HTTP ${response.status} responded, but its body could not be read`
    };
  }
  const finalUrl = response.url || url;
  if (response.status === 401 || response.status === 403 || response.status === 429) {
    recordCall("site-fetch", "substance", 0, `http_${response.status}_access_blocked`, "partial");
    return {
      kind: "failure",
      url: finalUrl,
      status: "access_blocked",
      reason: "http_access",
      detail: response.status === 429 ? "the site rate-limited the automated liveness request (HTTP 429)" : `the site denied the automated liveness request (HTTP ${response.status})`
    };
  }
  if (isAntiBotResponse(response, html)) {
    recordCall("site-fetch", "substance", 0, `anti_bot_http_${response.status}`, "partial");
    return {
      kind: "failure",
      url: finalUrl,
      status: "access_blocked",
      reason: "anti_bot",
      detail: `the site served an anti-bot challenge instead of its homepage (HTTP ${response.status})`
    };
  }
  if (!response.ok) {
    recordCall("site-fetch", "substance", 0, `http_${response.status}`, "failed");
    return {
      kind: "failure",
      url: finalUrl,
      status: "unavailable",
      reason: "http",
      detail: `the liveness request returned HTTP ${response.status}; this does not prove the site is offline`
    };
  }
  if ((opts?.requireHtml ?? true) && !/html/i.test(response.headers.get("content-type") ?? "")) {
    recordCall("site-fetch", "substance", 0, "unexpected_content_type", "partial");
    return {
      kind: "failure",
      url: finalUrl,
      status: "unavailable",
      reason: "content",
      detail: `the homepage returned ${response.headers.get("content-type") || "an unknown content type"}, not HTML`
    };
  }
  if (!html.trim()) {
    recordCall("site-fetch", "substance", 0, "empty_body", "partial");
    return {
      kind: "failure",
      url: finalUrl,
      status: "unavailable",
      reason: "content",
      detail: "the homepage returned an empty body; no liveness conclusion can be drawn"
    };
  }
  recordCall("site-fetch", "substance", 0, void 0, "succeeded");
  return { kind: "page", url: finalUrl, html };
}
function failedSiteResult(domain, failures) {
  const blocked = failures.find((failure) => failure.status === "access_blocked");
  if (blocked) return { url: blocked.url, status: blocked.status, reason: blocked.reason, detail: blocked.detail };
  const unavailable = failures.find((failure) => failure.status === "unavailable");
  if (unavailable) {
    return { url: unavailable.url, status: unavailable.status, reason: unavailable.reason, detail: unavailable.detail };
  }
  const reasons = new Set(failures.map((failure) => failure.reason));
  const reason = reasons.has("dns") && reasons.has("transport") ? "dns_and_transport" : reasons.has("dns") ? "dns" : "transport";
  return {
    url: `https://${domain}`,
    status: "unreachable",
    reason,
    detail: reason === "dns" ? `DNS resolution failed for ${domain}` : reason === "dns_and_transport" ? `DNS resolution and transport attempts both failed for ${domain}` : `transport requests failed for ${domain}`
  };
}
function bundleUrls(html, base) {
  const out = [];
  const re = /<script[^>]+src=["']([^"']+)["']/gi;
  let match;
  while ((match = re.exec(html)) && out.length < 3) {
    const src = match[1];
    if (/\.js(\?|$)/i.test(src) && !/googletagmanager|gtag|analytics|hotjar|intercom|segment|cdn\.jsdelivr|unpkg/i.test(src)) {
      try {
        const resolved = new URL(src, base);
        if (resolved.origin === new URL(base).origin) out.push(resolved.href);
      } catch {
      }
    }
  }
  return out;
}
function metaContent(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const nameFirst = html.match(new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"))?.[1];
  if (nameFirst) return nameFirst;
  return html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${escaped}["']`, "i"))?.[1] ?? "";
}
async function checkSiteSubstance(domain) {
  const d = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase().trim();
  if (!d || !/\.[a-z]{2,}$/i.test(d)) return null;
  const candidates = d.startsWith("www.") ? [`https://${d}`, `https://${d.slice(4)}`] : [`https://${d}`, `https://www.${d}`];
  const failures = [];
  let page;
  for (const candidate of candidates) {
    const result = await get(candidate);
    if (result.kind === "page") {
      page = result;
      break;
    }
    failures.push(result);
  }
  if (!page) return failedSiteResult(d, failures);
  const meta = metaContent(page.html, "description");
  const title = page.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1].replace(/\s+/g, " ").trim() ?? "";
  const body = stripText(page.html);
  const hasSubstantialProductSurface = body.length >= 400 && PRODUCT.test(body);
  if (PARKED.test(page.html)) {
    return {
      url: page.url,
      status: "coming_soon",
      reason: "parked",
      detail: "the served homepage is a registrar parking or domain-for-sale page"
    };
  }
  const hardComingMarker = HARD_COMING.test(`${title} ${meta}`);
  const comingOnlySurface = COMING.test(`${title} ${meta} ${body}`) && !hasSubstantialProductSurface;
  if (hardComingMarker || comingOnlySurface) {
    const excerpt = [title, meta].find((value) => COMING.test(value)) || body.match(COMING)?.[0] || "coming-soon marker";
    return {
      url: page.url,
      status: "coming_soon",
      reason: "coming_soon",
      detail: `the served homepage explicitly presents a coming-soon or waitlist surface ("${excerpt.slice(0, 80)}")`
    };
  }
  if (hasSubstantialProductSurface) {
    return { url: page.url, status: "live", detail: `live site${meta ? `: "${meta.slice(0, 80)}"` : ""}` };
  }
  const isShell = /id=["'](root|__next|app|__nuxt)["']/i.test(page.html) || /<script[^>]+type=["']module["']/i.test(page.html);
  if (isShell && body.length < 300) {
    let bundleHint = false;
    for (const bundle of bundleUrls(page.html, page.url)) {
      const js = await get(bundle, { requireHtml: false }).catch(() => null);
      if (!js || js.kind !== "page") continue;
      if (COMING.test(js.html) || /ComingSoon|Waitlist|EarlyAccess|UnderConstruction/i.test(js.html)) {
        bundleHint = true;
      }
    }
    return {
      url: page.url,
      status: "client_rendered",
      detail: bundleHint ? "client-rendered app; its bundle contains an unrendered coming-soon string, which is not treated as homepage liveness evidence" : `client-rendered app; static read could not confirm a product surface${meta ? ` ("${meta.slice(0, 80)}")` : ""}`
    };
  }
  return { url: page.url, status: "live", detail: `site is up${meta ? `: "${meta.slice(0, 80)}"` : ""}` };
}

// server/adapters/dexscreener.ts
var BASE = "https://api.dexscreener.com";
var isRecord = (value) => !!value && typeof value === "object" && !Array.isArray(value);
var recordDex = (op, status, detail) => {
  recordCall("dexscreener", op, 0, ["keyless", detail].filter(Boolean).join(" \xB7 "), status);
};
async function lookupToken(address) {
  let res;
  try {
    res = await fetch(`${BASE}/latest/dex/tokens/${address}`, {
      signal: AbortSignal.timeout(8e3)
    });
  } catch {
    recordDex("token-pairs", "failed", "transport_error");
    return null;
  }
  if (!res.ok) {
    recordDex("token-pairs", "failed", `http_${res.status}`);
    return null;
  }
  let data;
  try {
    data = await res.json();
  } catch {
    recordDex("token-pairs", "failed", "response_json_error");
    return null;
  }
  if (!isRecord(data) || !Array.isArray(data.pairs)) {
    recordDex("token-pairs", "partial", "result_shape_error");
    return null;
  }
  if (!data.pairs.length) {
    recordDex("token-pairs", "succeeded", "no_pairs");
    return { address };
  }
  const pairs = data.pairs.filter(isRecord);
  if (!pairs.length) {
    recordDex("token-pairs", "partial", "invalid_pair_rows");
    return null;
  }
  const top = pairs.reduce((a, b) => (b.liquidity?.usd ?? 0) > (a.liquidity?.usd ?? 0) ? b : a);
  const incomplete = pairs.length !== data.pairs.length || !top.chainId && !top.baseToken?.symbol && top.priceUsd == null && top.liquidity?.usd == null;
  recordDex("token-pairs", incomplete ? "partial" : "succeeded", incomplete ? "incomplete_pair_shape" : void 0);
  return {
    address,
    chain: top.chainId,
    symbol: top.baseToken?.symbol,
    priceUsd: top.priceUsd ? Number(top.priceUsd) : void 0,
    liquidityUsd: top.liquidity?.usd,
    volume24h: top.volume?.h24,
    fdv: top.fdv,
    pairCreatedAt: top.pairCreatedAt
  };
}
async function detectTokenLifecycle(ticker, knownAddress) {
  const sym = ticker.replace(/^\$/, "").trim();
  if (!sym) return null;
  let res;
  try {
    res = await fetch(`${BASE}/latest/dex/search?q=${encodeURIComponent(sym)}`, {
      signal: AbortSignal.timeout(8e3)
    });
  } catch {
    recordDex("token-search", "failed", "transport_error");
    return null;
  }
  if (!res.ok) {
    recordDex("token-search", "failed", `http_${res.status}`);
    return null;
  }
  let data;
  try {
    data = await res.json();
  } catch {
    recordDex("token-search", "failed", "response_json_error");
    return null;
  }
  if (!isRecord(data) || !Array.isArray(data.pairs)) {
    recordDex("token-search", "partial", "result_shape_error");
    return null;
  }
  try {
    const validRows = data.pairs.filter(isRecord);
    const pairs = validRows.filter((p) => (p.baseToken?.symbol ?? "").toLowerCase() === sym.toLowerCase());
    if (!pairs.length) {
      recordDex("token-search", validRows.length === data.pairs.length ? "succeeded" : "partial", validRows.length === data.pairs.length ? "no_match" : "invalid_pair_rows");
      return null;
    }
    const byAddr = /* @__PURE__ */ new Map();
    let missingAddress = 0;
    for (const p of pairs) {
      const a = p.baseToken?.address;
      if (!a) {
        missingAddress += 1;
        continue;
      }
      let arr = byAddr.get(a);
      if (!arr) {
        arr = [];
        byAddr.set(a, arr);
      }
      arr.push(p);
    }
    const generations = [...byAddr.entries()].map(([address, ps]) => {
      const created = ps.map((p) => p.pairCreatedAt).filter((x) => typeof x === "number");
      const top = ps.reduce((a, b) => (b.liquidity?.usd ?? 0) > (a.liquidity?.usd ?? 0) ? b : a);
      return {
        address,
        chain: top.chainId,
        firstLaunch: created.length ? Math.min(...created) : void 0,
        liquidityUsd: ps.reduce((s, p) => s + (p.liquidity?.usd ?? 0), 0),
        priceUsd: top.priceUsd ? Number(top.priceUsd) : void 0,
        h24: top.priceChange?.h24
      };
    }).sort((a, b) => (a.firstLaunch ?? 0) - (b.firstLaunch ?? 0));
    const migrated = generations.length >= 2;
    const canon = knownAddress ? generations.find((g) => g.address.toLowerCase() === knownAddress.toLowerCase()) : null;
    let dive = null;
    if (canon) {
      const nearZeroLiq = canon.liquidityUsd < 5e3;
      const crashed = (canon.h24 ?? 0) < -60;
      if (nearZeroLiq || crashed) {
        dive = {
          address: canon.address,
          detail: `liquidity $${Math.round(canon.liquidityUsd).toLocaleString()}${canon.h24 != null ? `, ${Math.round(canon.h24)}% 24h` : ""}${nearZeroLiq ? " (effectively dead)" : ""}`
        };
      }
    }
    const incomplete = validRows.length !== data.pairs.length || missingAddress > 0;
    recordDex("token-search", incomplete ? "partial" : "succeeded", incomplete ? "incomplete_pair_shape" : void 0);
    return { ticker: sym, generations, migrated, dive };
  } catch {
    recordDex("token-search", "partial", "result_processing_error");
    return null;
  }
}
var dexscreenerAdapter = {
  id: "dexscreener",
  label: "DexScreener",
  available: () => true,
  // keyless
  async run(ctx) {
    if (ctx.evidence.roles.includes("PROJECT" /* PROJECT */) && !ctx.evidence.roles.includes("KOL" /* KOL */)) {
      return { state: "skipped", attempts: 0, detail: "project-account token mentions are not KOL promotions" };
    }
    const promos = ctx.evidence.promotions.filter((p) => p.contract_address);
    if (!promos.length) return;
    ctx.emit({ phase: "On-chain", label: "DEX liquidity scan", detail: `Resolving ${promos.length} promoted token(s) on DexScreener\u2026`, tone: "neutral" });
    for (const p of promos) {
      const snap = await lookupToken(p.contract_address);
      if (!snap) continue;
      const thin = (snap.liquidityUsd ?? 0) < 1e4;
      p.perf_current = snap.priceUsd;
      ctx.recordCheck?.({
        id: "promoted-token-performance",
        status: thin ? "finding" : "confirmed",
        note: `$${snap.symbol ?? p.ticker} liquidity $${Math.round(snap.liquidityUsd ?? 0).toLocaleString()}${thin ? " (thin liquidity)" : ""}`,
        provider: "dexscreener",
        sourceCount: 1
      });
      ctx.emit({
        phase: "On-chain",
        label: `$${snap.symbol ?? p.ticker}`,
        detail: `liquidity $${Math.round(snap.liquidityUsd ?? 0).toLocaleString()}, 24h vol $${Math.round(snap.volume24h ?? 0).toLocaleString()}${thin ? " (thin liquidity, rug-risk flag)" : ""}`,
        source: "dexscreener",
        tone: thin ? "warn" : "neutral"
      });
    }
  }
};

// src/lib/cadence.ts
var DAY = 864e5;
var median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
function analyzeCadence(posts, now) {
  const times = posts.map((p) => p.createdAt).filter((t) => Number.isFinite(t)).sort((a, b) => b - a);
  if (times.length < 4) return null;
  const gaps = [];
  for (let i = 0; i < times.length - 1; i++) gaps.push((times[i] - times[i + 1]) / DAY);
  const medianGapDays = median(gaps);
  const recentGapDays = gaps[0];
  const daysSinceLast = (now - times[0]) / DAY;
  const half = Math.floor(gaps.length / 2);
  const recentMedian = median(gaps.slice(0, half || 1));
  const olderMedian = median(gaps.slice(half)) || medianGapDays;
  const decaying = olderMedian > 0 && recentMedian >= olderMedian * 3 && recentMedian - olderMedian >= 3;
  const silent = daysSinceLast >= Math.max(21, medianGapDays * 4);
  const summary = silent ? `Silent ${Math.round(daysSinceLast)}d (typical gap ~${medianGapDays.toFixed(1)}d): went quiet.` : decaying ? `Cadence thinning: recent gaps ~${recentMedian.toFixed(1)}d vs ~${olderMedian.toFixed(1)}d earlier.` : `Posting steady (~${medianGapDays.toFixed(1)}d gap, last post ${Math.round(daysSinceLast)}d ago).`;
  return { postsAnalyzed: times.length, daysSinceLast, medianGapDays, recentGapDays, decaying, silent, summary };
}

// src/lib/basicFactQuestions.ts
var EXPLICIT_EMPTY_PREDICATES = /* @__PURE__ */ new Set(["official_token", "public_security"]);
function basicFactQuestionOutcome(entry) {
  if (!entry) return "unresolved";
  if (entry.status === "answered") return "answered";
  return entry.providerRuns.at(-1)?.state === "completed_empty" ? "checked_empty" : "unresolved";
}
function supportsExplicitEmptyBasicFact(predicate) {
  return EXPLICIT_EMPTY_PREDICATES.has(canonicalBasicFactPredicate(predicate));
}
var PROJECT_QUESTIONS = [
  ["official_identity", "What is the project's official identity?"],
  ["product", "What does the project actually do?"],
  ["founder", "Who founded it?"],
  ["executive", "Who operates it today?"],
  ["founded", "When was it founded?"],
  ["launched", "When did the product launch?"],
  ["official_token", "Does it have an official token?"],
  ["network", "Which networks does it run on?"],
  ["legal_entity", "Which legal entity is responsible?"],
  ["funding", "How much funding has it raised?"],
  ["investor", "Who funded it?"],
  ["governance", "Who controls governance and the treasury?"],
  ["audit", "Has the code been independently audited?"],
  ["repository", "Where is the source code maintained?"],
  ["traction", "Is there evidence of real usage?"]
];
var FOUNDER_QUESTIONS = [
  ["official_identity", "Who is this person?"],
  ["current_role", "What do they lead or control today?"],
  ["founder", "Which companies or projects did they found?"],
  ["prior_role", "What did they do before?"],
  ["track_record", "What outcomes prove their track record?"],
  ["exit", "What exits or failures are verified?"],
  ["control", "What ownership, voting, or treasury control do they hold?"],
  ["conflict_of_interest", "What material conflicts are disclosed?"],
  ["legal_regulatory_event", "What legal or regulatory events actually name them?"],
  ["public_security", "Is a related asset a public security?"],
  ["official_token", "Is an official crypto token tied to a venture they control?"],
  ["education", "What education or credentials are verified?"]
];
var INVESTOR_QUESTIONS = [
  ["official_identity", "Who is this investor?"],
  ["current_role", "Which firm and fund do they represent today?"],
  ["investor", "Which investments are directly attributed to them?"],
  ["track_record", "What realized outcomes prove their track record?"],
  ["exit", "Which portfolio exits are verified?"],
  ["legal_entity", "Which legal entity manages the fund?"],
  ["control", "What board, voting, or investment control do they hold?"],
  ["conflict_of_interest", "What material conflicts are disclosed?"],
  ["legal_regulatory_event", "What legal or regulatory events name them or their firm?"],
  ["public_security", "Is a related asset a public security?"],
  ["official_token", "Is a crypto token directly tied to a venture they control?"]
];
var PERSON_QUESTIONS = [
  ["official_identity", "Who is this person?"],
  ["current_role", "What do they do today?"],
  ["prior_role", "What did they do before?"],
  ["founder", "What have they founded?"],
  ["track_record", "What outcomes are verified?"],
  ["legal_regulatory_event", "What material legal or regulatory events name them?"],
  ["official_token", "Is an official token tied to them?"]
];
var QUESTION_MAPS = {
  project: new Map(PROJECT_QUESTIONS),
  founder: new Map(FOUNDER_QUESTIONS),
  investor: new Map(INVESTOR_QUESTIONS),
  person: new Map(PERSON_QUESTIONS)
};
var PREDICATE_ALIASES = {
  identity: "official_identity",
  founders: "founder",
  cofounders: "founder",
  co_founders: "founder",
  team: "executive",
  leadership: "executive",
  core_team: "executive",
  token: "official_token",
  tokeneconomics: "official_token",
  tokenomics: "official_token",
  launch_date: "launched",
  launch: "launched",
  founding_date: "founded",
  incorporation: "legal_entity",
  company: "legal_entity",
  investors: "investor",
  fundraising: "funding",
  security_audits: "audit",
  audits: "audit",
  github: "repository",
  repositories: "repository",
  usage: "traction",
  adoption: "traction"
};
function canonicalBasicFactPredicate(value) {
  const normalized4 = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return PREDICATE_ALIASES[normalized4] ?? normalized4;
}

// server/adapters/peopledatalabs.ts
var BASE2 = "https://api.peopledatalabs.com/v5";
var asRecord3 = (value) => value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
var optionalString = (value) => typeof value === "string" && value.trim() ? value : void 0;
async function enrichPerson(params) {
  const key = env("PDL_API_KEY");
  if (!key) return null;
  const qs = new URLSearchParams();
  if (params.profile) qs.set("profile", params.profile);
  if (params.name) qs.set("name", params.name);
  if (params.company) qs.set("company", params.company);
  qs.set("min_likelihood", params.company || params.profile ? "4" : "8");
  let res;
  try {
    res = await fetch(`${BASE2}/person/enrich?${qs}`, {
      headers: { "X-Api-Key": key },
      signal: AbortSignal.timeout(1e4)
    });
  } catch {
    recordPdlMatch(false, "failed", "transport_error");
    return null;
  }
  if (!res.ok) {
    recordPdlMatch(false, "failed", `http_${res.status}`);
    return null;
  }
  let raw;
  try {
    raw = await res.json();
  } catch {
    recordPdlMatch(false, "failed", "response_json_error");
    return null;
  }
  const payload = asRecord3(raw);
  if (!payload || !("data" in payload)) {
    recordPdlMatch(false, "partial", "missing_data");
    return null;
  }
  if (payload.data == null) {
    recordPdlMatch(false, "succeeded", "no_match");
    return null;
  }
  const p = asRecord3(payload.data);
  if (!p) {
    recordPdlMatch(false, "partial", "invalid_person_shape");
    return null;
  }
  const issues = [];
  const fullName = optionalString(p.full_name);
  if (!fullName) issues.push("missing_full_name");
  const rawExperience = p.experience;
  if (rawExperience != null && !Array.isArray(rawExperience)) issues.push("invalid_experience");
  const experience = (Array.isArray(rawExperience) ? rawExperience : []).flatMap((value) => {
    const x = asRecord3(value);
    if (!x) {
      issues.push("invalid_experience_item");
      return [];
    }
    const company = asRecord3(x.company);
    const title = asRecord3(x.title);
    return [{
      company: optionalString(company?.name),
      title: optionalString(title?.name),
      start: optionalString(x.start_date),
      end: optionalString(x.end_date),
      url: optionalString(company?.website) || optionalString(company?.linkedin_url) || null
    }];
  });
  const emailCandidates = [
    p.work_email,
    ...Array.isArray(p.personal_emails) ? p.personal_emails : [],
    ...Array.isArray(p.emails) ? p.emails.map((email) => typeof email === "string" ? email : asRecord3(email)?.address) : []
  ];
  const person = {
    fullName,
    jobTitle: optionalString(p.job_title),
    jobCompany: optionalString(p.job_company_name),
    experience,
    linkedin: optionalString(p.linkedin_url),
    // Emails are the strongest cross-source bridge key: a PDL-resolved email that
    // MATCHES a leaked GitHub commit email proves the anon dev is this named person.
    emails: [...new Set(emailCandidates.filter((email) => typeof email === "string" && email.includes("@")).map((email) => email.toLowerCase()))],
    github: optionalString(p.github_username) ?? null,
    location: optionalString(p.location_name) ?? null
  };
  recordPdlMatch(
    true,
    issues.length ? "partial" : "succeeded",
    issues.length ? `incomplete_result:${[...new Set(issues)].join(",")}` : void 0
  );
  return person;
}
var httpify = (u) => u ? /^https?:\/\//.test(u) ? u : "https://" + u : null;
var peopledatalabsAdapter = {
  id: "peopledatalabs",
  label: "People Data Labs",
  available: () => !!env("PDL_API_KEY"),
  async run(ctx) {
    const handle = ctx.handle.replace(/^@/, "");
    const name = ctx.evidence.profile.display_name;
    const realName = name && name !== handle ? name : void 0;
    const companies = [...new Set(ctx.evidence.ventures.map((v) => v.project_name).filter(Boolean))];
    ctx.emit({ phase: "P1 \xB7 Identity", label: "Identity resolution", detail: `Enriching ${realName ?? "@" + handle} via People Data Labs${companies.length ? ", disambiguating with discovered companies" : ""}\u2026`, tone: "neutral" });
    let person = null;
    if (realName) {
      for (const company of companies.slice(0, 3)) {
        person = await enrichPerson({ name: realName, company });
        if (person) break;
      }
      if (!person) person = await enrichPerson({ name: realName });
    }
    if (!person) person = await enrichPerson({ profile: `twitter.com/${handle}` });
    if (!person) {
      ctx.recordCheck?.({
        id: "identity-resolution",
        status: "checked-empty",
        note: "licensed identity provider completed without a matching real-world record",
        provider: "peopledatalabs"
      });
      ctx.emit({ phase: "P1 \xB7 Identity", label: "No match", detail: "No real-world identity record matched; scored as pseudonymous (no penalty).", source: "peopledatalabs", tone: "neutral" });
      return;
    }
    ctx.evidence.profile.identity_confidence = person.linkedin ? "Probable" : ctx.evidence.profile.identity_confidence;
    if (person.fullName) ctx.evidence.profile.resolved_name = person.fullName;
    if (person.emails.length) ctx.evidence.profile.identity_emails = person.emails;
    const emailNote = person.emails.length ? ` Email on record: ${person.emails[0]}.` : "";
    ctx.evidence.profile.identity_note = `Resolved to ${person.fullName}, ${person.jobTitle ?? "role unknown"} @ ${person.jobCompany ?? "n/a"}. ${person.experience.length} roles on record${person.linkedin ? ` (${person.linkedin})` : ""}.${emailNote}`;
    ctx.recordCheck?.({
      id: "identity-resolution",
      status: "confirmed",
      note: `licensed identity record resolved to ${person.fullName}`,
      provider: "peopledatalabs",
      sourceCount: 1
    });
    ctx.recordCheck?.({
      id: "affiliations-associates",
      status: person.experience.length ? "confirmed" : "checked-empty",
      note: person.experience.length ? `${person.experience.length} employment record${person.experience.length === 1 ? "" : "s"} returned` : "resolved identity record returned no employment history",
      provider: "peopledatalabs",
      sourceCount: person.experience.length
    });
    ctx.emit({ phase: "P1 \xB7 Identity", label: "Identity resolved", detail: `${person.fullName} \xB7 ${person.experience.length} employment records${person.emails.length ? ` \xB7 ${person.emails[0]}` : ""}${person.linkedin ? ` \xB7 ${person.linkedin}` : ""}`, source: "peopledatalabs", tone: "good" });
    const byName = new Map(ctx.evidence.ventures.map((v) => [v.project_name.toLowerCase(), v]));
    const added = [];
    const confirmed = [];
    for (const x of person.experience) {
      const company = (x.company ?? "").trim();
      if (!company) continue;
      const key = company.toLowerCase();
      const title = x.title || "role on record";
      const period = [x.start, x.end].filter(Boolean).join("\u2013");
      const ex = byName.get(key);
      if (ex) {
        if (!/corroborated:/i.test(ex.notes ?? "")) {
          const base = (ex.notes ?? "").replace(/\s*·\s*single-source lead, unverified\s*$/i, "");
          ex.notes = [base, `corroborated: PDL employment record (${title}${period ? ", " + period : ""})`].filter(Boolean).join(" \xB7 ");
        }
        if (!ex.period && period) ex.period = period;
        if (!ex.evidence_url && x.url) ex.evidence_url = httpify(x.url);
        ex.provider = "peopledatalabs";
        ex.evidence_origin = "deterministic";
        ex.artifact_verified = true;
        confirmed.push(company);
      } else {
        const rec = {
          project_name: company,
          role: title,
          period,
          outcome: "Unknown" /* UNKNOWN */,
          evidence_url: httpify(x.url),
          notes: "People Data Labs employment record",
          provider: "peopledatalabs",
          evidence_origin: "deterministic",
          artifact_verified: true
        };
        ctx.evidence.ventures.push(rec);
        byName.set(key, rec);
        added.push(company);
      }
    }
    if (added.length) {
      ctx.emit({ phase: "P1 \xB7 Identity", label: "Career history", detail: `${added.length} employer(s) on record (incl. roles not on their X/profile): ${added.slice(0, 5).join(", ")}.`, source: "peopledatalabs", tone: "good" });
    }
    if (confirmed.length) {
      ctx.emit({ phase: "P1 \xB7 Identity", label: "Cross-source corroboration", detail: `PDL employment independently confirms: ${confirmed.slice(0, 5).join(", ")}.`, source: "peopledatalabs", tone: "good" });
    }
  }
};

// server/adapters/github.ts
var GH = "https://api.github.com";
var headers2 = (key) => ({
  authorization: `Bearer ${key}`,
  accept: "application/vnd.github+json",
  "user-agent": "argus-due-diligence"
});
var isRecord2 = (value) => !!value && typeof value === "object" && !Array.isArray(value);
function validGithubResult(path, value) {
  const clean4 = path.split("?")[0];
  if (clean4 === "/search/users") return isRecord2(value) && Array.isArray(value.items);
  if (/^\/users\/[^/]+\/(orgs|repos)$/.test(clean4)) return Array.isArray(value);
  if (/^\/users\/[^/]+$/.test(clean4)) return isRecord2(value) && typeof value.login === "string" && !!value.login.trim();
  return isRecord2(value) || Array.isArray(value);
}
async function ghJson(path, key) {
  const op = path.split("?")[0].split("/").slice(1, 3).join("/") || "api";
  const tier = "subscription/keyed";
  let res;
  try {
    res = await fetch(GH + path, { headers: headers2(key), signal: AbortSignal.timeout(8e3) });
  } catch {
    recordCall("github", op, 0, `${tier} \xB7 transport_error`, "failed");
    return null;
  }
  if (!res.ok) {
    recordCall("github", op, 0, `${tier} \xB7 http_${res.status}`, "failed");
    return null;
  }
  let value;
  try {
    value = await res.json();
  } catch {
    recordCall("github", op, 0, `${tier} \xB7 response_json_error`, "failed");
    return null;
  }
  if (!validGithubResult(path, value)) {
    recordCall("github", op, 0, `${tier} \xB7 result_shape_error`, "partial");
    return null;
  }
  recordCall("github", op, 0, tier, "succeeded");
  return value;
}
async function resolveGithub(handle, name, key) {
  const h = handle.replace(/^@/, "").toLowerCase();
  const candidates = /* @__PURE__ */ new Set([h]);
  for (const q of [name, handle.replace(/^@/, "")]) {
    if (!q) continue;
    const found = await ghJson(`/search/users?q=${encodeURIComponent(q)}&per_page=5`, key);
    for (const it of found?.items ?? []) candidates.add(it.login);
  }
  let weak = null;
  for (const login of [...candidates].slice(0, 8)) {
    const u = await ghJson(`/users/${encodeURIComponent(login)}`, key);
    if (!u) continue;
    if ((u.twitter_username ?? "").toLowerCase() === h) {
      return { login: u.login, name: u.name, bio: u.bio, company: u.company, confidence: "gold" };
    }
    if (!weak && u.login.toLowerCase() === h) {
      weak = { login: u.login, name: u.name, bio: u.bio, company: u.company, confidence: "weak" };
    }
  }
  return weak;
}
async function githubAffiliations(login, key) {
  const out = /* @__PURE__ */ new Map();
  const orgs = await ghJson(`/users/${encodeURIComponent(login)}/orgs`, key);
  for (const o of orgs ?? []) out.set(o.login.toLowerCase(), { org: o.login, description: o.description, via: "public org member" });
  const repos = await ghJson(`/users/${encodeURIComponent(login)}/repos?sort=pushed&type=all&per_page=30`, key);
  for (const r of repos ?? []) {
    if (r.fork) continue;
    const owner = r.owner;
    if (owner.type === "Organization" && owner.login.toLowerCase() !== login.toLowerCase()) {
      const k = owner.login.toLowerCase();
      if (!out.has(k)) out.set(k, { org: owner.login, via: `repo ${r.name}` });
    }
  }
  return [...out.values()].slice(0, 10);
}
var githubAdapter = {
  id: "github",
  label: "GitHub forensics",
  available: () => !!env("GITHUB_TOKEN"),
  async run(ctx) {
    const key = env("GITHUB_TOKEN");
    if (!key) return;
    const name = ctx.evidence.profile.display_name;
    ctx.emit({ phase: "P1 \xB7 Identity", label: "GitHub resolution", detail: `Matching ${ctx.handle} to a GitHub account by linked X handle\u2026`, source: "github", tone: "neutral" });
    const match = await resolveGithub(ctx.handle, name, key);
    if (!match) {
      ctx.recordCheck?.({
        id: "code-footprint-github",
        status: "checked-empty",
        note: "GitHub resolution completed without an account that links back to this X handle",
        provider: "github"
      });
      ctx.emit({ phase: "P1 \xB7 Identity", label: "No GitHub match", detail: "No GitHub account links back to this X handle.", source: "github", tone: "neutral" });
      return;
    }
    if (match.confidence === "weak") {
      ctx.recordCheck?.({
        id: "code-footprint-github",
        status: "unknown",
        note: `github.com/${match.login} shares the username but does not link back to the X account`,
        provider: "github"
      });
      ctx.emit({ phase: "P1 \xB7 Identity", label: "Possible GitHub", detail: `github.com/${match.login} shares the handle but does not link back to X. Unconfirmed, not attributed.`, source: "github", tone: "warn" });
      return;
    }
    ctx.evidence.profile.identity_confidence = "Probable";
    ctx.evidence.profile.identity_note = `GitHub github.com/${match.login}${match.name ? ` (${match.name})` : ""} links back to this X handle.`;
    ctx.recordCheck?.({
      id: "identity-resolution",
      status: "confirmed",
      note: `GitHub account ${match.login} links back to ${ctx.handle}`,
      provider: "github",
      sourceCount: 1
    });
    ctx.recordCheck?.({
      id: "code-footprint-github",
      status: "confirmed",
      note: `github.com/${match.login} resolved through its X handle field`,
      provider: "github",
      sourceCount: 1
    });
    ctx.emit({ phase: "P1 \xB7 Identity", label: "GitHub confirmed", detail: `github.com/${match.login} links back to ${ctx.handle} (twitter_username match).`, source: "github", tone: "good" });
    const affs = await githubAffiliations(match.login, key);
    if (!affs.length) {
      ctx.recordCheck?.({
        id: "affiliations-associates",
        status: "checked-empty",
        note: "resolved GitHub account has no public organization memberships or organization-repo contributions",
        provider: "github"
      });
      ctx.emit({ phase: "P1 \xB7 Identity", label: "No public orgs", detail: "GitHub account has no public org memberships or org-repo contributions.", source: "github", tone: "neutral" });
      return;
    }
    const have = new Set(ctx.evidence.ventures.map((v) => v.project_name.toLowerCase()));
    const added = [];
    for (const a of affs) {
      if (have.has(a.org.toLowerCase())) continue;
      have.add(a.org.toLowerCase());
      ctx.evidence.ventures.push({
        project_name: a.org,
        role: "github contributor",
        period: "",
        outcome: "Active" /* ACTIVE */,
        evidence_url: `https://github.com/${a.org}`,
        notes: `GitHub: ${a.via}`,
        provider: "github",
        evidence_origin: "deterministic",
        artifact_verified: true
      });
      ctx.evidence.associates.push({
        associate_handle: a.org,
        relation: "github org",
        evidence_url: `https://github.com/${a.org}`,
        provider: "github",
        evidence_origin: "deterministic",
        artifact_verified: true
      });
      added.push(a.org);
    }
    ctx.recordCheck?.({
      id: "affiliations-associates",
      status: "confirmed",
      note: `${affs.length} public GitHub organization affiliation${affs.length === 1 ? "" : "s"} returned`,
      provider: "github",
      sourceCount: affs.length
    });
    ctx.emit({ phase: "P1 \xB7 Identity", label: "GitHub affiliations", detail: `${added.length} org(s) this account builds with (near-permanent, hard to scrub): ${added.slice(0, 5).join(", ")}.`, source: "github", tone: "good" });
  }
};

// server/adapters/coingecko.ts
var PRO = "https://pro-api.coingecko.com/api/v3";
var PUBLIC = "https://api.coingecko.com/api/v3";
var PLATFORM = {
  ethereum: "ethereum",
  eth: "ethereum",
  base: "base",
  solana: "solana",
  bsc: "binance-smart-chain",
  polygon: "polygon-pos",
  arbitrum: "arbitrum-one"
};
async function tokenByContract(chain, address) {
  const key = env("COINGECKO_API_KEY");
  const platform = PLATFORM[chain.toLowerCase()] ?? chain.toLowerCase();
  const base = key ? PRO : PUBLIC;
  const headers4 = key ? { "x-cg-pro-api-key": key } : {};
  const tier = key ? "subscription/keyed" : "keyless";
  let res;
  try {
    res = await fetch(`${base}/coins/${platform}/contract/${address}`, {
      headers: headers4,
      signal: AbortSignal.timeout(1e4)
    });
  } catch {
    recordCall("coingecko", "contract-lookup", 0, `${tier} \xB7 transport_error`, "failed");
    return null;
  }
  if (!res.ok) {
    recordCall("coingecko", "contract-lookup", 0, `${tier} \xB7 http_${res.status}`, "failed");
    return null;
  }
  let d;
  try {
    d = await res.json();
  } catch {
    recordCall("coingecko", "contract-lookup", 0, `${tier} \xB7 response_json_error`, "failed");
    return null;
  }
  if (!d || typeof d !== "object" || Array.isArray(d)) {
    recordCall("coingecko", "contract-lookup", 0, `${tier} \xB7 result_shape_error`, "partial");
    return null;
  }
  const hasSymbol = typeof d.symbol === "string" && !!d.symbol.trim();
  const hasName = typeof d.name === "string" && !!d.name.trim();
  if (!hasSymbol && !hasName) {
    recordCall("coingecko", "contract-lookup", 0, `${tier} \xB7 missing_identity`, "partial");
    return null;
  }
  const complete = hasSymbol && hasName && (d.market_data == null || typeof d.market_data === "object" && !Array.isArray(d.market_data));
  recordCall(
    "coingecko",
    "contract-lookup",
    0,
    complete ? tier : `${tier} \xB7 incomplete_market_shape`,
    complete ? "succeeded" : "partial"
  );
  return {
    symbol: d.symbol,
    name: d.name,
    priceUsd: d.market_data?.current_price?.usd,
    mcapUsd: d.market_data?.market_cap?.usd,
    ath_change_pct: d.market_data?.ath_change_percentage?.usd
  };
}
var coingeckoAdapter = {
  id: "coingecko",
  label: "CoinGecko",
  available: () => true,
  // public endpoint works without key (rate limited)
  async run(ctx) {
    if (ctx.evidence.roles.includes("PROJECT" /* PROJECT */) && !ctx.evidence.roles.includes("KOL" /* KOL */)) {
      return { state: "skipped", attempts: 0, detail: "project-account token mentions are not KOL promotions" };
    }
    const promos = ctx.evidence.promotions.filter((p) => p.contract_address && p.chain);
    if (!promos.length) return;
    ctx.emit({ phase: "On-chain", label: "Market data", detail: "Cross-referencing promoted tokens against CoinGecko (source of record)\u2026", tone: "neutral" });
    for (const p of promos) {
      const t = await tokenByContract(p.chain, p.contract_address);
      if (!t) continue;
      const downBad = (t.ath_change_pct ?? 0) < -90;
      ctx.recordCheck?.({
        id: "promoted-token-performance",
        status: downBad ? "finding" : "confirmed",
        note: `$${t.symbol?.toUpperCase() ?? p.ticker} market record returned${t.ath_change_pct == null ? "" : ` \xB7 ${Math.round(t.ath_change_pct)}% from ATH`}`,
        provider: "coingecko",
        sourceCount: 1
      });
      ctx.emit({
        phase: "On-chain",
        label: `$${t.symbol?.toUpperCase() ?? p.ticker}`,
        detail: `mcap $${Math.round(t.mcapUsd ?? 0).toLocaleString()}${downBad ? `, ${Math.round(t.ath_change_pct)}% from ATH (collapsed)` : ""}`,
        source: "coingecko",
        tone: downBad ? "warn" : "neutral"
      });
    }
  }
};

// server/adapters/onchain.ts
var isHeliusTransaction = (value) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value;
  return typeof row.signature === "string" && row.signature.trim().length > 0 && (row.timestamp === void 0 || typeof row.timestamp === "number");
};
async function collectHeliusWalletActivity(address) {
  const key = env("HELIUS_API_KEY");
  if (!key) {
    return {
      activity: null,
      state: "skipped",
      detail: "Helius is not configured",
      attempted: false
    };
  }
  let res;
  try {
    res = await fetch(
      `https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${key}&limit=50`,
      { signal: AbortSignal.timeout(8e3) }
    );
  } catch {
    recordHelius("address-transactions", "failed", "subscription/keyed \xB7 transport_error");
    return { activity: null, state: "failed", detail: "Helius transport error", attempted: true };
  }
  if (!res.ok) {
    recordHelius("address-transactions", "failed", `subscription/keyed \xB7 http_${res.status}`);
    return { activity: null, state: "failed", detail: `Helius HTTP ${res.status}`, attempted: true };
  }
  let value;
  try {
    value = await res.json();
  } catch {
    recordHelius("address-transactions", "failed", "subscription/keyed \xB7 response_json_error");
    return { activity: null, state: "failed", detail: "Helius response JSON error", attempted: true };
  }
  if (!Array.isArray(value)) {
    recordHelius("address-transactions", "partial", "subscription/keyed \xB7 result_shape_error");
    return { activity: null, state: "partial", detail: "Helius result shape was incomplete", attempted: true };
  }
  const transactions = value.filter(isHeliusTransaction);
  const malformed = transactions.length !== value.length;
  recordHelius(
    "address-transactions",
    malformed ? "partial" : "succeeded",
    malformed ? "subscription/keyed \xB7 incomplete_transaction_shape" : "subscription/keyed"
  );
  return {
    activity: {
      count: transactions.length,
      latest: typeof transactions[0]?.timestamp === "number" ? transactions[0].timestamp : void 0
    },
    state: malformed ? "partial" : "executed",
    detail: malformed ? "Helius returned at least one incomplete transaction row" : "Helius transaction history returned",
    attempted: true
  };
}
var attributedSolanaWallets = (evidence) => evidence.wallets.filter(
  (wallet) => wallet.chain === "solana" && (wallet.link_tier === "SelfDoxxed" || wallet.link_tier === "InvestigatorAttributed")
);
var onchainAdapter = {
  id: "onchain",
  label: "On-chain forensics (Helius)",
  available: () => !!env("HELIUS_API_KEY"),
  applicable: (evidence) => attributedSolanaWallets(evidence).length > 0,
  async run(ctx) {
    if (!env("HELIUS_API_KEY")) {
      return { state: "skipped", attempts: 0, detail: "Helius is not configured" };
    }
    const wallets = attributedSolanaWallets(ctx.evidence);
    if (!wallets.length) {
      return { state: "skipped", attempts: 0, detail: "no attributed Solana wallet was available for Helius" };
    }
    ctx.emit({ phase: "On-chain", label: "Wallet forensics", detail: `Examining ${wallets.length} attributed wallet(s)\u2026`, tone: "neutral" });
    const outcomes = [];
    for (const w of wallets) {
      const outcome = await collectHeliusWalletActivity(w.address);
      outcomes.push(outcome);
      if (outcome.activity) {
        w.activity_summary = `${outcome.activity.count} recent txs`;
        ctx.emit({ phase: "On-chain", label: `${w.address.slice(0, 6)}\u2026`, detail: `${outcome.activity.count} recent transactions`, source: "helius", tone: w.sold_into_own_promo ? "bad" : "neutral" });
      }
    }
    const attempts = outcomes.filter((outcome) => outcome.attempted);
    if (!attempts.length) {
      return { state: "skipped", attempts: 0, detail: "no Helius provider attempt was observed" };
    }
    const failed = attempts.filter((outcome) => outcome.state === "failed").length;
    const partial = attempts.filter((outcome) => outcome.state === "partial").length;
    const state = failed === attempts.length ? "failed" : failed || partial ? "partial" : "executed";
    return {
      state,
      attempts: attempts.length,
      detail: `${attempts.length} Helius attempt${attempts.length === 1 ? "" : "s"} \xB7 ${failed} failed \xB7 ${partial} partial`
    };
  }
};

// server/adapters/basicFacts.ts
import { createHash as createHash4 } from "node:crypto";
import { isIP as isIP2 } from "node:net";

// server/publicWeb.ts
import { createHash as createHash3 } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";
var MAX_TEXT_BYTES = 15e5;
var MAX_REDIRECTS = 4;
var JINA_READER_ORIGIN = "https://r.jina.ai/";
var PUBLIC_WEB_USER_AGENT = "ARGUS/3.0 (+https://argus-one-flax.vercel.app; due-diligence evidence research)";
var JINA_RECOVERABLE_FAILURES = /* @__PURE__ */ new Set([
  "anti_bot_challenge",
  "http_403",
  "http_429",
  "transport_error",
  "response_stream_error"
]);
var JINA_TRANSIENT_FAILURES = /* @__PURE__ */ new Set([
  "http_422",
  "http_429",
  "transport_error",
  "response_stream_error"
]);
var SENSITIVE_URL_PARAM2 = /^(?:(?:x[-_]?(?:amz|goog)|x[-_](?:oss|cos))[-_].+|x[-_]ms[-_](?:signature|token|credential)|access[_-]?token|api[_-]?key|key|token|signature|sig|auth|credential|credentials|security[_-]?token|session[_-]?token|awsaccesskeyid|googleaccessid|key[_-]?pair[_-]?id|policy|cf[_-]?access[_-]?token)$/i;
var CAPABILITY_PATH_LABEL = /^(?:auth|invite|magic|private|secret|share|signed|token)$/i;
var SAFE_CONTENT_TYPES = /* @__PURE__ */ new Set([
  "application/json",
  "application/ld+json",
  "application/xhtml+xml",
  "text/html",
  "text/markdown",
  "text/plain",
  "text/xml"
]);
function antiBotChallengeHeaders(headers4) {
  const mitigation = headers4.get("cf-mitigated") ?? "";
  const captcha = headers4.get("x-datadome") ?? headers4.get("x-captcha") ?? "";
  return /challenge|captcha/i.test(`${mitigation} ${captcha}`);
}
function antiBotChallengeBody(contentType, text2) {
  if (!/html|xhtml/i.test(contentType)) return false;
  const sample = text2.slice(0, 2e5);
  const cloudflareTitle = /<title[^>]*>\s*just a moment(?:\.{3})?\s*<\/title>/i.test(sample);
  const cloudflareRuntime = /(?:\/cdn-cgi\/challenge-platform\/|challenges\.cloudflare\.com|\bcf-chl-)/i.test(sample);
  const otherChallengeRuntime = /(?:captcha-delivery|_pxcaptcha|perimeterx|datadome|incapsula|akamai bot manager)/i.test(sample);
  const humanPrompt = /(?:verify (?:that )?you are human|checking (?:your )?browser(?: before accessing)?|enable javascript and cookies to continue)/i.test(sample);
  return cloudflareTitle && cloudflareRuntime || otherChallengeRuntime && humanPrompt;
}
function normalizedJinaSource(text2) {
  const matches = [...text2.matchAll(/^URL Source:\s*(\S+)\s*$/gm)];
  if (matches.length !== 1) return null;
  try {
    const source2 = new URL(matches[0][1]);
    if (source2.protocol !== "https:" && source2.protocol !== "http:" || source2.username || source2.password) return null;
    source2.hash = "";
    return source2.toString();
  } catch {
    return null;
  }
}
function pathnameMayContainCapability(url) {
  const segments = url.pathname.split("/").filter(Boolean).map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  });
  return segments.some((segment, index) => {
    if (CAPABILITY_PATH_LABEL.test(segment) && Boolean(segments[index + 1])) return true;
    return /^(?:share|invite|token|secret)[-_][A-Za-z0-9_-]{12,}$/i.test(segment);
  });
}
function isPublicIpAddress(address) {
  const version = isIP(address);
  if (version === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 0 && c === 0 || a === 192 && b === 0 && c === 2 || a === 192 && b === 88 && c === 99 || a === 192 && b === 168 || a === 198 && (b === 18 || b === 19) || a === 198 && b === 51 && c === 100 || a === 203 && b === 0 && c === 113 || a >= 224);
  }
  if (version === 6) {
    const value = address.toLowerCase();
    const parts = value.split(":");
    const first = Number.parseInt(parts[0] || "0", 16);
    const second = Number.parseInt(parts[1] || "0", 16);
    if (!Number.isFinite(first) || first < 8192 || first > 16383) return false;
    if (first === 8194 || first === 16382) return false;
    if (first === 8193 && (second === 0 || second === 2 || second >= 16 && second <= 47 || second === 3512)) return false;
    return true;
  }
  return false;
}
var defaultLookup = async (hostname2) => dnsLookup(hostname2, { all: true, verbatim: true });
var normalizedHostname = (value) => value.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
async function validatedPublicTarget(raw, base, lookup = defaultLookup) {
  let url;
  try {
    url = base ? new URL(raw, base) : new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:" || url.username || url.password) return null;
  if (url.port && !(url.protocol === "https:" && url.port === "443" || url.protocol === "http:" && url.port === "80")) return null;
  if ([...url.searchParams.keys()].some((key) => SENSITIVE_URL_PARAM2.test(key))) return null;
  const hostname2 = normalizedHostname(url.hostname);
  if (!hostname2 || isIP(hostname2) || hostname2 === "localhost" || hostname2.endsWith(".localhost") || hostname2.endsWith(".local") || hostname2.endsWith(".internal")) return null;
  try {
    const resolved = await lookup(hostname2);
    if (!resolved.length) return null;
    const addresses = resolved.map((entry) => ({
      address: entry.address,
      // Trust the parsed address rather than provider-supplied family metadata.
      family: isIP(entry.address)
    }));
    if (addresses.some((entry) => !entry.family || !isPublicIpAddress(entry.address))) return null;
    url.hash = "";
    return {
      url,
      hostname: hostname2,
      addresses: Object.freeze(addresses.map((entry) => Object.freeze({ ...entry })))
    };
  } catch {
    return null;
  }
}
var pinnedLookupFor = (target) => (hostname2, options, callback) => {
  const requestedHost = normalizedHostname(hostname2);
  if (requestedHost !== target.hostname) {
    const error = new Error("socket lookup hostname differed from validated target");
    error.code = "EACCES";
    callback(error, "", 0);
    return;
  }
  const publicAddresses = target.addresses.filter((entry) => entry.family === isIP(entry.address) && isPublicIpAddress(entry.address));
  const requestedFamily = options.family === "IPv4" ? 4 : options.family === "IPv6" ? 6 : options.family;
  const eligible = requestedFamily === 4 || requestedFamily === 6 ? publicAddresses.filter((entry) => entry.family === requestedFamily) : publicAddresses;
  if (!eligible.length) {
    const error = new Error("validated target has no public address for requested family");
    error.code = "EACCES";
    callback(error, "", 0);
    return;
  }
  if (options.all) callback(null, eligible.map((entry) => ({ ...entry })));
  else callback(null, eligible[0].address, eligible[0].family);
};
var responseHeaders = (rawHeaders) => {
  const headers4 = new Headers();
  for (let index = 0; index + 1 < rawHeaders.length; index += 2) {
    headers4.append(rawHeaders[index], rawHeaders[index + 1]);
  }
  return headers4;
};
function fetchCompatibleResponseStatus(statusCode) {
  if (typeof statusCode === "number" && Number.isInteger(statusCode) && statusCode >= 200 && statusCode <= 599) return statusCode;
  if (typeof statusCode === "number" && Number.isInteger(statusCode) && statusCode >= 600 && statusCode <= 999) return 403;
  return 502;
}
var nativeRequest = (url, options) => new Promise((resolve, reject) => {
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  const requestOptions = {
    method: "GET",
    headers: options.headers,
    signal: options.signal,
    lookup: options.lookup,
    // Never reuse a socket whose connection was established under another DNS
    // decision. Every hop must exercise this request's pinned lookup.
    agent: false
  };
  const outgoing = request(url, requestOptions, (incoming) => {
    try {
      const upstreamStatus = incoming.statusCode;
      const status = fetchCompatibleResponseStatus(upstreamStatus);
      const headers4 = responseHeaders(incoming.rawHeaders);
      if (status !== upstreamStatus && upstreamStatus !== void 0) {
        headers4.set("x-argus-upstream-status", String(upstreamStatus));
      }
      const statusText = status === upstreamStatus ? incoming.statusMessage : "Upstream response rejected";
      const noBody = status === 204 || status === 205 || status === 304 || status >= 300 && status < 400;
      if (noBody) {
        incoming.resume();
        resolve(new Response(null, { status, statusText, headers: headers4 }));
        return;
      }
      const body = Readable.toWeb(incoming);
      resolve(new Response(body, { status, statusText, headers: headers4 }));
    } catch (error) {
      incoming.destroy();
      reject(error);
    }
  });
  outgoing.once("error", reject);
  outgoing.end();
});
async function readBoundedText(response) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_TEXT_BYTES) return null;
  if (!response.body) return Buffer.alloc(0);
  const chunks = [];
  const reader = response.body.getReader();
  let total = 0;
  for (; ; ) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_TEXT_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}
async function fetchValidatedPublicText(initialTarget, dependencies = {}, accept = "text/html,application/xhtml+xml,application/json,text/plain;q=0.8") {
  const request = dependencies.request ?? nativeRequest;
  const lookup = dependencies.lookup ?? defaultLookup;
  let target = initialTarget;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    let response;
    try {
      response = await request(target.url, {
        signal: AbortSignal.timeout(8e3),
        headers: {
          accept,
          "accept-language": "en-US,en;q=0.8",
          "user-agent": PUBLIC_WEB_USER_AGENT
        },
        lookup: pinnedLookupFor(target)
      });
    } catch {
      return { status: "failed", reason: "transport_error" };
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirect === MAX_REDIRECTS) return { status: "failed", reason: "invalid_or_excessive_redirect" };
      target = await validatedPublicTarget(location, target.url, lookup);
      if (!target) return { status: "rejected", reason: "unsafe_redirect" };
      continue;
    }
    if (antiBotChallengeHeaders(response.headers)) {
      return { status: "failed", reason: "anti_bot_challenge" };
    }
    if (!response.ok) return { status: "failed", reason: `http_${response.status}` };
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (contentType && !SAFE_CONTENT_TYPES.has(contentType)) {
      return { status: "failed", reason: "unsupported_content_type" };
    }
    let bytes;
    try {
      bytes = await readBoundedText(response);
    } catch {
      return { status: "failed", reason: "response_stream_error" };
    }
    if (!bytes) return { status: "failed", reason: "response_too_large" };
    const text2 = bytes.toString("utf8");
    if (!text2.trim()) return { status: "failed", reason: "empty_response" };
    if (antiBotChallengeBody(contentType, text2)) {
      return { status: "failed", reason: "anti_bot_challenge" };
    }
    return {
      status: "ok",
      url: target.url.toString(),
      host: target.url.hostname.replace(/^www\./i, "").toLowerCase(),
      contentType: contentType || "text/plain",
      text: text2,
      contentHash: createHash3("sha256").update(bytes).digest("hex"),
      capturedAt: (dependencies.now?.() ?? /* @__PURE__ */ new Date()).toISOString()
    };
  }
  return { status: "failed", reason: "redirect_loop" };
}
async function fetchPublicText(raw, dependencies = {}) {
  const lookup = dependencies.lookup ?? defaultLookup;
  const target = await validatedPublicTarget(raw, void 0, lookup);
  if (!target) return { status: "rejected", reason: "unsafe_or_unresolvable_url" };
  return fetchValidatedPublicText(target, dependencies);
}
async function fetchPublicTextWithRecovery(raw, dependencies = {}) {
  const lookup = dependencies.lookup ?? defaultLookup;
  const originalTarget = await validatedPublicTarget(raw, void 0, lookup);
  if (!originalTarget) return { status: "rejected", reason: "unsafe_or_unresolvable_url" };
  const direct = await fetchValidatedPublicText(originalTarget, dependencies);
  if (direct.status === "ok") {
    return {
      ...direct,
      retrievalMethod: "direct",
      retrievalProvider: "origin",
      retrievalUrl: direct.url
    };
  }
  if (direct.status === "rejected") return direct;
  if (!JINA_RECOVERABLE_FAILURES.has(direct.reason)) return direct;
  if (originalTarget.url.search) return direct;
  if (pathnameMayContainCapability(originalTarget.url)) return direct;
  const readerTarget = await validatedPublicTarget(
    `${JINA_READER_ORIGIN}${originalTarget.url.toString()}`,
    void 0,
    lookup
  );
  if (!readerTarget) return { status: "failed", reason: "reader_target_validation_failed" };
  let recovered = await fetchValidatedPublicText(readerTarget, dependencies, "text/plain,text/markdown;q=0.9");
  if (recovered.status === "failed" && JINA_TRANSIENT_FAILURES.has(recovered.reason)) {
    await (dependencies.wait ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs))))(750);
    recovered = await fetchValidatedPublicText(readerTarget, dependencies, "text/plain,text/markdown;q=0.9");
  }
  if (recovered.status !== "ok") {
    return { status: "failed", reason: `reader_recovery_failed_${recovered.reason}` };
  }
  if (recovered.url !== readerTarget.url.toString()) {
    return { status: "failed", reason: "reader_redirect_mismatch" };
  }
  if (normalizedJinaSource(recovered.text) !== originalTarget.url.toString()) {
    return { status: "failed", reason: "reader_source_mismatch" };
  }
  return {
    ...recovered,
    // Evidence classification and citations must stay bound to the source the
    // model named, never to the rendering intermediary.
    url: originalTarget.url.toString(),
    host: originalTarget.hostname.replace(/^www\./i, "").toLowerCase(),
    retrievalMethod: "reader_recovery",
    retrievalProvider: "jina-reader",
    retrievalUrl: recovered.url
  };
}

// server/adapters/basicFacts.ts
var ANTHROPIC_URL2 = "https://api.anthropic.com/v1/messages";
var PRIMARY_SEARCH_USES_PER_BATCH = 3;
var REPAIR_SEARCH_USES = 4;
var DISCOVERY_BATCH_CONCURRENCY = 3;
var DISCOVERY_RETRY_DELAY_MS = 350;
var MAX_LEADS = 28;
var MAX_SOURCES = 32;
var MAX_REPAIR_QUESTIONS = 8;
var MAX_REPAIR_PROVIDER_CALLS = 8;
var DISCOVERY_TIMEOUT_MS = 5e4;
var RESEARCH_CACHE_VERSION = "v7";
var SENSITIVE_URL_PARAM3 = /^(?:(?:x[-_]?(?:amz|goog)|x[-_](?:oss|cos))[-_].+|x[-_]ms[-_](?:signature|token|credential)|access[_-]?token|api[_-]?key|key|token|signature|sig|auth|credential|credentials|security[_-]?token|session[_-]?token|awsaccesskeyid|googleaccessid|key[_-]?pair[_-]?id|policy|cf[_-]?access[_-]?token)$/i;
var PREDICATES = /* @__PURE__ */ new Set([
  "official_identity",
  "current_role",
  "prior_role",
  "education",
  "founder",
  "executive",
  "founded",
  "launched",
  "exit",
  "track_record",
  "official_token",
  "public_security",
  "funding",
  "investor",
  "product",
  "network",
  "legal_entity",
  "legal_regulatory_event",
  "governance",
  "control",
  "conflict_of_interest",
  "tokenomics",
  "vesting",
  "treasury",
  "audit",
  "repository",
  "traction"
]);
var CRITICAL_PREDICATES = /* @__PURE__ */ new Set([
  "official_identity",
  "current_role",
  "product",
  "founder",
  "executive",
  "track_record",
  "official_token",
  "public_security"
]);
var LEAD_COVERAGE_CATEGORIES = [
  ["official_identity"],
  ["current_role", "prior_role"],
  ["education"],
  ["founder"],
  ["executive"],
  ["product"],
  ["exit", "track_record"],
  ["legal_entity"],
  ["official_token"],
  ["public_security"],
  ["tokenomics"],
  ["vesting"],
  ["treasury"],
  ["audit"],
  ["traction"],
  ["governance"],
  ["control", "conflict_of_interest"],
  ["legal_regulatory_event"],
  ["repository"],
  ["funding", "investor"],
  ["network"],
  ["founded", "launched"]
];
function selectBasicFactLeads(leads) {
  if (leads.length <= MAX_LEADS) return leads.slice();
  const selected = /* @__PURE__ */ new Set();
  for (const predicates of LEAD_COVERAGE_CATEGORIES) {
    const index = leads.findIndex((lead, leadIndex) => !selected.has(leadIndex) && predicates.includes(lead.predicate));
    if (index >= 0) selected.add(index);
  }
  for (let index = 0; index < leads.length && selected.size < MAX_LEADS; index += 1) {
    selected.add(index);
  }
  return leads.filter((_lead, index) => selected.has(index)).slice(0, MAX_LEADS);
}
var PROJECT_QUESTIONS2 = [
  { batch: "identity", predicate: "official_identity", question: "What exact project or company does this account represent?", critical: true },
  { batch: "identity", predicate: "founder", question: "Who founded or co-founded the project? Return one person per answer.", critical: true },
  { batch: "identity", predicate: "executive", question: "Who currently leads or operates the project? Return one person and role per answer.", critical: true },
  { batch: "identity", predicate: "founded", question: "When was the project founded?" },
  { batch: "track_record", predicate: "product", question: "What live products or services does the project provide?", critical: true },
  { batch: "track_record", predicate: "launched", question: "When did its product, protocol, or mainnet launch?", critical: true },
  { batch: "track_record", predicate: "official_token", question: "What is the project's official crypto token, if any?", critical: true },
  { batch: "track_record", predicate: "public_security", question: "Does the organization have a publicly traded equity or debt security distinct from any crypto token?" },
  { batch: "track_record", predicate: "network", question: "Which blockchain networks or chains does it run on?", critical: true },
  { batch: "track_record", predicate: "funding", question: "What source-backed funding rounds or amounts has it raised?", critical: true },
  { batch: "track_record", predicate: "investor", question: "Which named investors or backers are source-backed? Return one per answer." },
  { batch: "track_record", predicate: "repository", question: "Where is the official source code maintained?", critical: true },
  { batch: "track_record", predicate: "traction", question: "What concrete, dated usage, revenue, volume, users, fees, TVL, or adoption metrics are public?", critical: true },
  { batch: "structure_risk", predicate: "legal_entity", question: "Which legal entity is responsible for the project?", critical: true },
  { batch: "structure_risk", predicate: "legal_regulatory_event", question: "What material legal or regulatory events are publicly documented, who are they attributed to, and what is each event's current stated status?" },
  { batch: "structure_risk", predicate: "governance", question: "What formal governance process is documented?", critical: true },
  { batch: "structure_risk", predicate: "control", question: "Who has practical control through ownership, boards, voting power, admin keys, multisigs, or treasury authority?" },
  { batch: "structure_risk", predicate: "conflict_of_interest", question: "What explicit related-party arrangements or conflicts of interest are disclosed?" },
  { batch: "structure_risk", predicate: "tokenomics", question: "What token allocation or supply disclosures are published?" },
  { batch: "structure_risk", predicate: "vesting", question: "What vesting, lockup, or unlock schedule is published?" },
  { batch: "structure_risk", predicate: "treasury", question: "What treasury assets, reports, wallets, or controls are disclosed?" },
  { batch: "structure_risk", predicate: "audit", question: "Which independent security audits or reviews are published?", critical: true }
];
var PERSON_QUESTIONS2 = [
  { batch: "identity", predicate: "official_identity", question: "What is this person's source-backed public identity?", critical: true },
  { batch: "identity", predicate: "current_role", question: "What roles does this person currently hold? Return one role and organization per answer.", critical: true },
  { batch: "identity", predicate: "prior_role", question: "What material prior roles did this person hold? Return one role and organization per answer." },
  { batch: "identity", predicate: "education", question: "What education or credentials are explicitly documented? Return one institution or credential per answer." },
  { batch: "identity", predicate: "founder", question: "Which companies or projects did this person found or co-found? Return one venture per answer." },
  { batch: "identity", predicate: "executive", question: "Which executive roles are source-backed? Return one role and organization per answer." },
  { batch: "track_record", predicate: "founded", question: "When were the person's principal ventures founded? Return one dated venture per answer." },
  { batch: "track_record", predicate: "product", question: "What products or protocols did this person materially build or lead? Return one per answer." },
  { batch: "track_record", predicate: "exit", question: "What acquisitions, IPOs, sales, shutdowns, or other venture exits are source-backed? Return one event per answer." },
  { batch: "track_record", predicate: "track_record", question: "What concrete operating or investment outcomes establish this person's track record? Return one measurable outcome per answer." },
  { batch: "structure_risk", predicate: "official_token", question: "Which crypto token is officially tied to a venture this person controls, if any? Do not report public-company stock here.", critical: true },
  { batch: "structure_risk", predicate: "public_security", question: "Which publicly traded equity or debt security is tied to a company this person controls, if any? Do not report a crypto token here.", critical: true },
  { batch: "structure_risk", predicate: "legal_regulatory_event", question: "What material legal or regulatory events explicitly name this person, and what is each event's stated status? Never transfer a company-only event to the person." },
  { batch: "structure_risk", predicate: "governance", question: "What formal governance roles does this person hold?" },
  { batch: "structure_risk", predicate: "control", question: "What ownership, voting, board, admin-key, multisig, or treasury control is explicitly attributed to this person?" },
  { batch: "structure_risk", predicate: "conflict_of_interest", question: "What explicit conflicts of interest or related-party arrangements are attributed to this person?" }
];
var INVESTOR_QUESTIONS2 = [
  { batch: "identity", predicate: "official_identity", question: "What is this investor's source-backed public identity?", critical: true },
  { batch: "identity", predicate: "current_role", question: "What investment role and firm does this person currently hold?", critical: true },
  { batch: "identity", predicate: "prior_role", question: "What material prior investing or operating roles did this person hold?" },
  { batch: "identity", predicate: "education", question: "What education or professional credentials are explicitly documented?" },
  { batch: "identity", predicate: "founder", question: "Which companies, funds, or projects did this person found or co-found? Return one per answer." },
  { batch: "identity", predicate: "executive", question: "Which material operating or executive roles are source-backed? Return one role and organization per answer." },
  { batch: "track_record", predicate: "investor", question: "Which investments are explicitly attributed to this person rather than merely to an affiliated fund? Return one per answer.", critical: true },
  { batch: "track_record", predicate: "funding", question: "Which rounds did this person or their currently affiliated fund publicly lead or join? Return one per answer." },
  { batch: "track_record", predicate: "founded", question: "When were the person's principal companies, funds, or projects founded?" },
  { batch: "track_record", predicate: "product", question: "What products, protocols, or investment platforms did this person materially build or lead?" },
  { batch: "track_record", predicate: "exit", question: "Which portfolio exits or realized outcomes are source-backed and correctly attributed?" },
  { batch: "track_record", predicate: "track_record", question: "What concrete fund, portfolio, or operating outcomes establish this investor's track record?", critical: true },
  { batch: "structure_risk", predicate: "public_security", question: "Which publicly traded security is directly relevant to this investor or controlled company, if any?", critical: true },
  { batch: "structure_risk", predicate: "official_token", question: "Which official crypto token is directly tied to a venture this investor controls, if any? Do not treat a stock ticker as a token.", critical: true },
  { batch: "structure_risk", predicate: "legal_entity", question: "Which legal entity employs the investor or manages the disclosed fund?" },
  { batch: "structure_risk", predicate: "legal_regulatory_event", question: "What material legal or regulatory events explicitly name this investor or their firm, with exact attribution and current stated status?" },
  { batch: "structure_risk", predicate: "governance", question: "What formal board, governance, or voting roles are documented?" },
  { batch: "structure_risk", predicate: "control", question: "What ownership, board, voting, or investment-committee control is explicitly documented?" },
  { batch: "structure_risk", predicate: "conflict_of_interest", question: "What explicit related-party arrangements or conflicts of interest are disclosed?" }
];
var FOUNDER_REPAIR_PREDICATES = new Set(
  PERSON_QUESTIONS2.map((question) => question.predicate)
);
var REPAIR_PRIORITY = {
  person: [
    "official_identity",
    "current_role",
    "founder",
    "product",
    "control",
    "legal_regulatory_event",
    "official_token",
    "public_security",
    "track_record",
    "executive",
    "governance",
    "conflict_of_interest",
    "founded",
    "exit",
    "prior_role",
    "education"
  ],
  project: [
    "official_identity",
    "founder",
    "executive",
    "product",
    "official_token",
    "traction",
    "audit",
    "legal_entity",
    "network",
    "launched",
    "funding",
    "repository",
    "governance"
  ],
  investor: [
    "official_identity",
    "current_role",
    "investor",
    "track_record",
    "founder",
    "control",
    "public_security",
    "official_token",
    "product",
    "legal_regulatory_event",
    "funding",
    "governance"
  ]
};
function boundedRepairQuestions(questions) {
  if (questions.length <= MAX_REPAIR_QUESTIONS) return questions.slice();
  const audience = questions[0]?.audience ?? "person";
  const priorities = REPAIR_PRIORITY[audience];
  const rank = new Map(priorities.map((predicate, index) => [predicate, index]));
  return questions.map((question, index) => ({ question, index })).sort((left, right) => (rank.get(left.question.predicate) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right.question.predicate) ?? Number.MAX_SAFE_INTEGER) || left.index - right.index).slice(0, MAX_REPAIR_QUESTIONS).map(({ question }) => question);
}
function researchAudience(ctx) {
  if (ctx.evidence.roles.some((role) => String(role) === "PROJECT")) return "project";
  if (ctx.evidence.roles.some((role) => String(role) === "INVESTOR")) return "investor";
  return "person";
}
function basicFactsResearchQuestions(ctx) {
  const audience = researchAudience(ctx);
  const templates = audience === "project" ? PROJECT_QUESTIONS2 : audience === "investor" ? INVESTOR_QUESTIONS2 : PERSON_QUESTIONS2;
  const founderSubject = ctx.evidence.roles.some((role) => String(role) === "FOUNDER");
  return templates.map((template) => ({
    id: `${audience}.${template.predicate}`,
    audience,
    batch: template.batch,
    predicate: template.predicate,
    question: template.question,
    critical: Boolean(
      template.critical || audience !== "project" && founderSubject && FOUNDER_REPAIR_PREDICATES.has(template.predicate)
    )
  }));
}
var clean = (value, max) => typeof value === "string" && value.trim() ? value.trim().slice(0, max) : void 0;
var normalize = (value) => value.normalize("NFKC").replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\s+/g, " ").trim();
var searchable = (value) => normalize(value).toLowerCase().replace(/[^a-z0-9@$.'-]+/g, " ").replace(/\s+/g, " ").trim();
var looseTokens = (value) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
var looseContainsPhrase = (text2, phrase) => {
  const haystack = ` ${looseTokens(text2).join(" ")} `;
  const needle = looseTokens(phrase).join(" ");
  return !!needle && haystack.includes(` ${needle} `);
};
var STRUCTURED_VALUE_PREDICATES = /* @__PURE__ */ new Set([
  "current_role",
  "prior_role",
  "founder",
  "executive",
  "founded",
  "product",
  "exit",
  "track_record",
  "public_security"
]);
var VALUE_STOP_TOKENS = /* @__PURE__ */ new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "inc",
  "into",
  "of",
  "on",
  "or",
  "our",
  "the",
  "their",
  "to",
  "with"
]);
var ROLE_DESCRIPTOR_TOKENS = /* @__PURE__ */ new Set([
  "adviser",
  "advisor",
  "board",
  "chair",
  "chief",
  "co",
  "director",
  "engineer",
  "executive",
  "founder",
  "head",
  "investor",
  "lead",
  "manager",
  "member",
  "officer",
  "partner",
  "president",
  "principal",
  "software",
  "ceo",
  "cfo",
  "coo",
  "cto"
]);
var VALUE_DESCRIPTOR_TOKENS = {
  current_role: ROLE_DESCRIPTOR_TOKENS,
  prior_role: ROLE_DESCRIPTOR_TOKENS,
  founder: /* @__PURE__ */ new Set(["co", "founder"]),
  executive: ROLE_DESCRIPTOR_TOKENS,
  founded: /* @__PURE__ */ new Set(["co", "established", "formed", "founded", "incorporated"]),
  product: /* @__PURE__ */ new Set([
    "app",
    "application",
    "crypto",
    "exchange",
    "marketplace",
    "platform",
    "product",
    "protocol",
    "service",
    "wallet"
  ]),
  exit: /* @__PURE__ */ new Set([
    "acquired",
    "acquisition",
    "direct",
    "exit",
    "ipo",
    "listing",
    "nasdaq",
    "nyse",
    "offering",
    "public",
    "sale",
    "sold"
  ]),
  track_record: /* @__PURE__ */ new Set([
    "adoption",
    "aum",
    "billion",
    "customer",
    "download",
    "fee",
    "million",
    "revenue",
    "transaction",
    "tvl",
    "user",
    "volume"
  ]),
  public_security: /* @__PURE__ */ new Set([
    "bond",
    "class",
    "common",
    "debt",
    "equity",
    "ipo",
    "listed",
    "nasdaq",
    "nyse",
    "public",
    "security",
    "ticker",
    "traded"
  ])
};
var TICKER_EXCLUSIONS = /* @__PURE__ */ new Set([
  "CEO",
  "CFO",
  "COO",
  "CTO",
  "INC",
  "IPO",
  "LLC",
  "LTD",
  "NASDAQ",
  "NYSE"
]);
var PUBLIC_SECURITY_CORPORATE_MODIFIERS = /* @__PURE__ */ new Set([
  "company",
  "corp",
  "corporation",
  "global",
  "group",
  "holding",
  "holdings"
]);
var HOST_CONTEXT_STOP_TOKENS = /* @__PURE__ */ new Set([
  "about",
  "blog",
  "co",
  "com",
  "docs",
  "io",
  "investor",
  "investors",
  "ir",
  "net",
  "news",
  "org",
  "press",
  "relations",
  "www"
]);
function canonicalValueTokens(value) {
  const canonical2 = value.replace(/\bco[-\s]?founders?\b/gi, " founder ").replace(/\bchief executive officer\b/gi, " ceo ").replace(/\bchief financial officer\b/gi, " cfo ").replace(/\bchief operating officer\b/gi, " coo ").replace(/\bchief technology officer\b/gi, " cto ").replace(/\bchair(?:man|woman|person)\b/gi, " chair ").replace(/\bcryptocurrenc(?:y|ies)\b/gi, " crypto ").replace(/\binitial public offering\b/gi, " ipo ").replace(/\b(?:shares?|stocks?)\b/gi, " equity ").replace(/\bassets under management\b/gi, " aum ").replace(/\btotal value locked\b/gi, " tvl ").replace(/\bcustomers?\b/gi, " customer ").replace(/\busers?\b/gi, " user ").replace(/\bfees?\b/gi, " fee ").replace(/\btransactions?\b/gi, " transaction ").replace(/\bdownloads?\b/gi, " download ");
  return [...new Set(looseTokens(canonical2).filter((token) => !VALUE_STOP_TOKENS.has(token)))];
}
function primaryTickerCandidate(value) {
  const leading = value.match(/^\s*\$?([A-Z][A-Z0-9.-]{1,7})(?=$|[^A-Z0-9])/)?.[1];
  if (leading && !TICKER_EXCLUSIONS.has(leading)) return leading;
  const exchangeLabeled = value.match(/\b(?:NASDAQ|NYSE)\s*:\s*\$?([A-Z][A-Z0-9.-]{1,7})\b/i)?.[1]?.toUpperCase();
  if (exchangeLabeled && !TICKER_EXCLUSIONS.has(exchangeLabeled)) return exchangeLabeled;
  const labeled = value.match(/\b(?:ticker|symbol)\s*[:=]?\s*\$?([A-Z][A-Z0-9.-]{1,7})\b/i)?.[1]?.toUpperCase();
  return labeled && !TICKER_EXCLUSIONS.has(labeled) ? labeled : null;
}
function escapedPattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function tickerIsExplicitlyIdentified(passage, ticker) {
  const symbol = escapedPattern(ticker);
  return [
    new RegExp(`\\b(?:ticker|symbol)(?:\\s+symbol)?\\s*(?:is|:|=)?\\s*\\$?${symbol}\\b`, "i"),
    new RegExp(`\\bunder\\s+(?:the\\s+)?(?:ticker(?:\\s+symbol)?\\s+)?\\$?${symbol}\\b`, "i"),
    new RegExp(`\\b(?:nasdaq|nyse)\\s*[:(]\\s*\\$?${symbol}\\b`, "i"),
    new RegExp(`\\(\\s*\\$?${symbol}\\s*\\)\\s+(?:is\\s+)?(?:listed|traded|stock|shares?)\\b`, "i"),
    new RegExp(`\\b(?:stock|shares?)\\s+(?:ticker|symbol)\\s*[:=]?\\s*\\$?${symbol}\\b`, "i")
  ].some((pattern) => pattern.test(passage));
}
function structuredValueIsSupported(passage, lead, trustedContextTokens = /* @__PURE__ */ new Set()) {
  if (!STRUCTURED_VALUE_PREDICATES.has(lead.predicate)) return false;
  const valueTokens = canonicalValueTokens(lead.value);
  if (!valueTokens.length) return false;
  const passageTokens = new Set(canonicalValueTokens(passage));
  const numericTokens = valueTokens.filter((token) => /^\d/.test(token));
  if (numericTokens.some((token) => !passageTokens.has(token))) return false;
  if (lead.predicate === "track_record") {
    const metricTokens = /* @__PURE__ */ new Set([
      "adoption",
      "aum",
      "customer",
      "download",
      "fee",
      "revenue",
      "transaction",
      "tvl",
      "user",
      "volume"
    ]);
    const claimedMetrics = valueTokens.filter((token) => metricTokens.has(token));
    if (claimedMetrics.length && !claimedMetrics.some((token) => passageTokens.has(token))) return false;
  }
  const descriptors = VALUE_DESCRIPTOR_TOKENS[lead.predicate] ?? /* @__PURE__ */ new Set();
  const anchors = valueTokens.filter((token) => !descriptors.has(token) && !/^\d/.test(token));
  const anchorIsPresent = (token) => passageTokens.has(token) || trustedContextTokens.has(token);
  if (lead.predicate === "public_security") {
    const ticker = primaryTickerCandidate(lead.value);
    if (ticker && !tickerIsExplicitlyIdentified(passage, ticker)) return false;
    if (/\bnasdaq\b/i.test(lead.value) && !/\bnasdaq\b/i.test(passage)) return false;
    if (/\bnyse\b/i.test(lead.value) && !/\bnyse\b/i.test(passage)) return false;
    const nonTickerAnchors = anchors.filter((token) => ticker?.toLowerCase() !== token && !PUBLIC_SECURITY_CORPORATE_MODIFIERS.has(token));
    if (nonTickerAnchors.length) {
      if (!nonTickerAnchors.some(anchorIsPresent)) return false;
    }
    if (ticker) return true;
  }
  if (anchors.length && !anchors.some(anchorIsPresent)) return false;
  const matched = valueTokens.filter((token) => passageTokens.has(token) || anchors.includes(token) && trustedContextTokens.has(token)).length;
  const required = valueTokens.length <= 3 ? valueTokens.length : Math.ceil(valueTokens.length * 0.7);
  return matched >= required;
}
function trustedHostContextTokens(host) {
  return new Set(canonicalValueTokens(host.replace(/\./g, " ")).filter((token) => !HOST_CONTEXT_STOP_TOKENS.has(token)));
}
var MATERIAL_SECURITY_CLAIMS = [
  /\bclass\s+[a-z0-9]+\b/i,
  /\bcommon stock\b/i,
  /\bpreferred stock\b/i,
  /\bconvertible (?:note|debt|bond)\b/i,
  /\bsenior (?:secured |unsecured )?(?:debt|bond|note)\b/i,
  /\bsubordinated (?:debt|bond|note)\b/i,
  /\bsecured (?:debt|bond|note)\b/i
];
function originalValueToken(value, token) {
  for (const match of value.matchAll(/[\p{L}\p{N}]+/gu)) {
    if (looseTokens(match[0])[0] === token) return match[0];
  }
  return null;
}
function verifiedPublicSecurityValue(value, passage) {
  const ticker = primaryTickerCandidate(value);
  if (!ticker || !tickerIsExplicitlyIdentified(passage, ticker)) return null;
  if (/\bnasdaq\b/i.test(value) && !/\bnasdaq\b/i.test(passage)) return null;
  if (/\bnyse\b/i.test(value) && !/\bnyse\b/i.test(passage)) return null;
  const descriptorTokens = VALUE_DESCRIPTOR_TOKENS.public_security ?? /* @__PURE__ */ new Set();
  const anchors = canonicalValueTokens(value).filter((token) => !descriptorTokens.has(token) && !PUBLIC_SECURITY_CORPORATE_MODIFIERS.has(token) && !/^\d/.test(token) && token !== ticker.toLowerCase());
  const issuerToken = anchors.find((token) => looseContainsPhrase(passage, token));
  if (!issuerToken) return null;
  const issuer = originalValueToken(value, issuerToken);
  if (!issuer) return null;
  const venue = /\bnasdaq\b/i.test(passage) ? "NASDAQ" : /\bnyse\b/i.test(passage) ? "NYSE" : null;
  const supportedClass = MATERIAL_SECURITY_CLAIMS.map((pattern) => pattern.exec(value)?.[0]).find((claim) => claim && looseContainsPhrase(passage, claim));
  return `${ticker} (${issuer}, ${venue ? `${venue}-listed` : "publicly traded"} ${supportedClass ?? "security"})`;
}
function safeCandidateUrl(value) {
  if (typeof value !== "string" || value.length > 2e3) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (url.protocol !== "https:" && url.protocol !== "http:" || url.username || url.password || !host || isIP2(host) || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || [...url.searchParams.keys()].some((key) => SENSITIVE_URL_PARAM3.test(key))) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}
function parsePayload(text2) {
  const fenced = text2.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? text2.match(/\{[\s\S]*\}/)?.[0];
  if (!candidate) return null;
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function rawBasicFactCount(text2) {
  const payload = parsePayload(text2);
  return payload && Array.isArray(payload.facts) ? payload.facts.length : null;
}
function isAtomicValue(predicate, value) {
  if (/[;\n]/.test(value)) return false;
  if (/\s(?:and|&)\s/i.test(value) && predicate !== "current_role" && predicate !== "prior_role") return false;
  if (["founder", "executive", "investor"].includes(predicate) && value.includes(",")) return false;
  return true;
}
function atomicPersonVentureValue(value) {
  const candidate = normalize(value);
  if (!candidate || candidate.length > 120 || /[()[\]{}/|;]/.test(candidate) || /\b(?:also known as|formerly|originally|previously|rebrand(?:ed)?|aka)\b/i.test(candidate) || /\b(?:co[- ]?)?founder\s+(?:of|at)\b/i.test(candidate) || /\s(?:and|&)\s/i.test(candidate)) return null;
  const tokens = looseTokens(candidate);
  return tokens.length >= 1 && tokens.length <= 8 ? candidate : null;
}
function canonicalOfficialTokenLeadValue(value) {
  const normalized4 = normalize(value);
  const symbol = "\\$?[A-Za-z][A-Za-z0-9.-]{1,15}";
  const leading = new RegExp(`^(${symbol})\\s*\\([^)]{2,100}\\)\\s*(?:[\xB7:\\u2013\\u2014]|\\s-\\s|$)`).exec(normalized4)?.[1];
  if (leading) return leading;
  const delimited = new RegExp(`^(${symbol})\\s*(?:[\xB7:\\u2013\\u2014]|\\s-\\s)\\s+\\S`).exec(normalized4)?.[1];
  if (delimited) return delimited;
  const named = new RegExp(`^[^();]{2,100}\\(\\s*(${symbol})\\s*\\)\\s*(?:[\xB7:\\u2013\\u2014]|\\s-\\s|$)`).exec(normalized4)?.[1];
  return named ?? normalized4;
}
function canonicalOfficialIdentityLeadValue(value) {
  const normalized4 = normalize(value);
  if (/\b(?:alleged|claimed|purported|self[- ]?described|unconfirmed|unverified)\b/i.test(normalized4)) return null;
  const nameToken = "[\\p{L}\\p{M}][\\p{L}\\p{M}'\u2019.-]*";
  const role = "(?:co[- ]?)?founder|chief executive officer|chief technology officer|chief operating officer|chief financial officer|ceo|cto|coo|cfo|president|chair(?:man|woman|person)?|partner|principal|entrepreneur|investor";
  const match = new RegExp(
    `^(${nameToken}(?:\\s+${nameToken}){1,5})\\s*(?:,\\s*|:\\s*|[\\u2013\\u2014]\\s*|\\s-\\s+|\\(\\s*)(?=${role}\\b)`,
    "iu"
  ).exec(normalized4);
  if (!match?.[1]) return /[,;:()[\]\u2013\u2014]/u.test(normalized4) ? null : normalized4;
  const candidate = normalize(match[1]);
  return plausiblePersonIdentity(candidate) ? candidate : null;
}
function isEmptyAssetPlaceholder(predicate, value) {
  if (!supportsExplicitEmptyBasicFact(predicate)) return false;
  const normalized4 = normalize(value).toLowerCase().replace(/[.!]+$/, "").trim();
  return /^(?:n\/?a|none|no|not applicable|not found|unknown|unavailable)$/.test(normalized4) || /^(?:no|does not have|has no)\s+(?:known\s+|verified\s+|official\s+|native\s+|governance\s+)?(?:crypto\s+)?(?:token|security|stock|bond)s?$/.test(normalized4);
}
function parseBasicFactLeads(text2, expectedSubject, provider = "claude-web-search", questions = []) {
  const payload = parsePayload(text2);
  if (!payload || !Array.isArray(payload.facts)) return null;
  const leads = [];
  const seen = /* @__PURE__ */ new Set();
  const questionById = new Map(questions.map((question) => [question.id, question]));
  const questionsByPredicate = /* @__PURE__ */ new Map();
  for (const question of questions) {
    questionsByPredicate.set(question.predicate, [
      ...questionsByPredicate.get(question.predicate) ?? [],
      question
    ]);
  }
  for (const raw of payload.facts) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const row = raw;
    const predicate = clean(row.predicate, 40);
    const subject = clean(expectedSubject ?? row.subject, 160);
    const rawValue = clean(row.value, 240);
    const excerpt = clean(row.exact_excerpt ?? row.excerpt, 1200);
    const sourceUrl = safeCandidateUrl(row.source_url ?? row.sourceUrl);
    if (!predicate || !PREDICATES.has(predicate) || !subject || !rawValue || !excerpt || !sourceUrl) continue;
    const suppliedQuestionId = clean(row.question_id ?? row.questionId, 100);
    const value = predicate === "official_token" ? canonicalOfficialTokenLeadValue(rawValue) : predicate === "official_identity" && /^(?:person|investor)\./.test(suppliedQuestionId ?? "") ? canonicalOfficialIdentityLeadValue(rawValue) : rawValue;
    if (!value) continue;
    if (isEmptyAssetPlaceholder(predicate, value)) continue;
    if (!isAtomicValue(predicate, value)) continue;
    const suppliedQuestion = suppliedQuestionId ? questionById.get(suppliedQuestionId) : void 0;
    if (questions.length && suppliedQuestionId && !suppliedQuestion) continue;
    if (questions.length && !questionsByPredicate.get(predicate)?.length) continue;
    if (suppliedQuestion && suppliedQuestion.predicate !== predicate) continue;
    const inferredQuestion = suppliedQuestion ?? (questionsByPredicate.get(predicate)?.length === 1 ? questionsByPredicate.get(predicate)?.[0] : void 0);
    if (predicate === "founder" && inferredQuestion && inferredQuestion.audience !== "project" && !atomicPersonVentureValue(value)) continue;
    const qualifier = clean(row.qualifier, 120);
    const eventStatus = clean(row.event_status ?? row.eventStatus, 160);
    const attributedEntity = clean(row.attributed_entity ?? row.attributedEntity, 200);
    if (predicate === "legal_regulatory_event" && (!eventStatus || !attributedEntity)) continue;
    const sourceTitle = clean(row.source_title ?? row.sourceTitle, 240);
    const rawCandidateUrls = row.candidate_urls ?? row.candidateUrls;
    const candidateUrls2 = Array.isArray(rawCandidateUrls) ? [...new Set(rawCandidateUrls.flatMap((candidate) => {
      const safe = safeCandidateUrl(candidate);
      return safe && safe !== sourceUrl ? [safe] : [];
    }))].slice(0, 4) : [];
    const key = `${predicate}::${searchable(value)}::${sourceUrl}::${searchable(excerpt)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    leads.push({
      subject,
      predicate,
      value,
      ...qualifier ? { qualifier } : {},
      ...inferredQuestion ? { questionId: inferredQuestion.id } : {},
      ...eventStatus ? { eventStatus } : {},
      ...attributedEntity ? { attributedEntity } : {},
      excerpt,
      sourceUrl,
      ...sourceTitle ? { sourceTitle } : {},
      ...candidateUrls2.length ? { candidateUrls: candidateUrls2 } : {},
      evidence_origin: "model_lead",
      artifact_verified: false,
      provider
    });
  }
  return selectBasicFactLeads(leads);
}
function subjectName(ctx) {
  return ctx.evidence.profile.resolved_name?.trim() || ctx.evidence.profile.display_name.trim() || ctx.handle.replace(/^@/, "");
}
function handleDerivedPersonName(ctx) {
  if (researchAudience(ctx) === "project") return null;
  const display = normalize(ctx.evidence.profile.display_name);
  if (looseTokens(display).length !== 1 || !new RegExp("^\\p{L}[\\p{L}\\p{M}'\u2019.-]*$", "u").test(display)) return null;
  const handle = ctx.handle.replace(/^@/, "").trim();
  if (!handle.toLocaleLowerCase().startsWith(display.toLocaleLowerCase())) return null;
  const rawSuffix = handle.slice(display.length).replace(/^[_-]+/, "");
  if (!rawSuffix || /\d/u.test(rawSuffix)) return null;
  const suffixParts = rawSuffix.includes("_") || rawSuffix.includes("-") ? rawSuffix.split(/[_-]+/u) : [rawSuffix];
  if (!suffixParts.length || suffixParts.length > 3 || suffixParts.some((part) => !new RegExp("^\\p{L}[\\p{L}\\p{M}'\u2019]{2,30}$", "u").test(part))) return null;
  const genericSuffixes = /* @__PURE__ */ new Set([
    "aave",
    "crypto",
    "dao",
    "defi",
    "eth",
    "ethereum",
    "labs",
    "nft",
    "official",
    "sol",
    "solana",
    "web3"
  ]);
  if (suffixParts.some((part) => genericSuffixes.has(part.toLocaleLowerCase()))) return null;
  const suffix = suffixParts.map((part) => `${part.slice(0, 1).toLocaleUpperCase()}${part.slice(1)}`).join(" ");
  const candidate = `${display} ${suffix}`;
  return plausiblePersonIdentity(candidate) ? candidate : null;
}
function officialIdentityBootstrapLeads(ctx) {
  const candidate = handleDerivedPersonName(ctx);
  const rawWebsite = ctx.evidence.profile.website;
  if (!candidate || !rawWebsite) return [];
  let website;
  try {
    website = new URL(rawWebsite);
  } catch {
    return [];
  }
  if (!/^https?:$/.test(website.protocol) || PATH_TENANTED_HOSTS.has(normalizedHost(website.hostname))) return [];
  const urls = [...new Set([
    new URL("/about", website.origin).toString(),
    new URL("/", website.origin).toString(),
    new URL("/team", website.origin).toString(),
    new URL("/leadership", website.origin).toString()
  ].map(safeCandidateUrl).filter((value) => Boolean(value)))];
  const [sourceUrl, ...candidateUrls2] = urls;
  if (!sourceUrl) return [];
  return [{
    subject: subjectName(ctx),
    predicate: "official_identity",
    value: candidate,
    questionId: `${researchAudience(ctx)}.official_identity`,
    excerpt: candidate,
    sourceUrl,
    sourceTitle: "Official identity page candidate",
    candidateUrls: candidateUrls2,
    evidence_origin: "deterministic_bootstrap",
    artifact_verified: false,
    provider: "argus-identity-bootstrap"
  }];
}
function subjectAliases(ctx) {
  const aliases = [
    subjectName(ctx),
    ctx.evidence.profile.display_name,
    ctx.evidence.profile.resolved_name,
    ctx.handle,
    ctx.handle.replace(/^@/, "")
  ].filter((value) => Boolean(value?.trim()));
  return [...new Set(aliases.map((value) => value.trim()))];
}
function discoveryPrompt(ctx, questions, phase = "primary") {
  const profile = ctx.evidence.profile;
  const audience = questions[0]?.audience ?? researchAudience(ctx);
  const questionLedger2 = questions.map(
    (question, index) => `${index + 1}. [${question.id}] (${question.predicate}${question.critical ? ", decision-critical" : ""}) ${question.question}`
  ).join("\n");
  const targetedAssetInstruction = questions.length === 1 && questions[0]?.predicate === "public_security" ? "This is a question-specific public-security search. Prefer the issuer's investor-relations site or an official regulator filing. Return a row only when the cited passage identifies the issuer plus an explicit ticker, exchange listing, stock, bond, equity, or debt security." : questions.length === 1 && questions[0]?.predicate === "official_token" ? `This is a question-specific official-token search. Search the official sites and documentation of the subject's verified current ventures. Return a row only for an affirmatively named official crypto token. If the completed search finds no affirmative source-linked token candidate, return {"facts":[]}; never serialize none, no token, a public-company stock, or an unlaunched token plan as a fact.` : "";
  const identitySearchHint = handleDerivedPersonName(ctx);
  let officialSearchHost = "";
  try {
    officialSearchHost = profile.website ? new URL(profile.website).hostname : "";
  } catch {
  }
  const targetedIdentityInstruction = questions.length === 1 && questions[0]?.predicate === "official_identity" && audience !== "project" ? [
    "This is an identity-bootstrap search. The profile display name may be incomplete.",
    identitySearchHint ? `Handle-derived full-name candidate: "${identitySearchHint}". Use it only as a search query and verify it from the cited page.` : "Search for the person's exact full public name using the handle, bio, and official website.",
    officialSearchHost && identitySearchHint ? `Start with a query equivalent to site:${officialSearchHost} "${identitySearchHint}", then check independent primary or reputable sources.` : "",
    "The value must contain only the person's full public name. Do not append a title, role, organization, biography, or second person."
  ].filter(Boolean).join(" ") : "";
  const verifiedVentureContext = verifiedVentureAssetRelationships(ctx).map((relationship) => `${relationship.name} (${relationship.officialScopes.join(", ")})`).join("; ");
  return [
    `${phase === "repair" ? "Repair the remaining verified-evidence gaps" : "Research foundational due-diligence facts"} for ${subjectName(ctx)} (${ctx.handle}).`,
    `Research audience: ${audience}. Answer only the targeted questions below; do not pad the response with adjacent facts.`,
    profile.website ? `Known official website: ${profile.website}` : "",
    profile.bio ? `Profile bio: ${profile.bio.slice(0, 800)}` : "",
    identitySearchHint ? `Unverified full-name search hint derived from the public handle: ${identitySearchHint}. Use it to find evidence, never as evidence itself.` : "",
    verifiedVentureContext ? `Verified current venture relationships (relationship evidence only, not proof of any stock or token): ${verifiedVentureContext}` : "",
    "Targeted question ledger:",
    questionLedger2,
    targetedAssetInstruction,
    targetedIdentityInstruction,
    "Prefer official first-party pages and primary documents, then reputable independent reporting.",
    "An official counterparty page may support a role, investment, acquisition, or other relationship when it explicitly names both sides. Still return the exact page and passage so ARGUS can verify it.",
    "Return one atomic value per row. Never combine multiple founders, people, investors, tokens, networks, or products in one value.",
    "Set question_id to the exact bracketed question ID. The predicate must match that question.",
    "Each exact_excerpt must be a verbatim one-to-three sentence passage that itself explicitly contains the subject identity, the claimed value, and language proving the predicate.",
    "For traction facts, copy the source's exact as-of date or reporting period into qualifier, preferably an explicit date phrase, only when that phrase appears in exact_excerpt. Never infer, normalize, or invent a date. Omit qualifier when the source does not state a period.",
    "Keep an official crypto token separate from a publicly traded equity or debt security. Never put stock in official_token and never put a crypto token in public_security.",
    "For legal_regulatory_event, include attributed_entity and event_status only when the exact excerpt states them. Never attribute a company-only event to a founder or employee.",
    "Keep formal governance, practical control, and explicit conflicts of interest separate. Do not infer control or a conflict from a job title alone.",
    "For candidate_urls, include up to three additional public pages that explicitly state the same atomic fact. Prefer the project's official site, docs, governance forum, or primary documents, then independent reporting. Do not repeat source_url.",
    "Do not infer. A search answer is only a lead; ARGUS will fetch and verify every URL independently.",
    "Return JSON only in this exact shape:",
    `{"facts":[{"question_id":"${questions[0]?.id ?? `${audience}.official_identity`}","subject":"...","predicate":"${questions.map((question) => question.predicate).join("|")}","value":"one atomic value","qualifier":"optional verbatim role, metric label, or traction as-of/reporting period present in exact_excerpt","event_status":"optional, exact source wording","attributed_entity":"optional, exact source wording","exact_excerpt":"verbatim source passage","source_url":"https://...","source_title":"...","candidate_urls":["https://..."]}]}`
  ].filter(Boolean).join("\n");
}
function responseText(response) {
  return (response.content ?? []).filter((block) => block.type === "text" && typeof block.text === "string").map((block) => block.text).join("\n");
}
function claudeRequestBody(prompt, assistantContent, maxSearchUses = PRIMARY_SEARCH_USES_PER_BATCH) {
  return {
    model: ANALYST_MODEL,
    max_tokens: 3e3,
    system: "You are ARGUS's basic-facts research scout. Search broadly, cite precisely, and return only the requested JSON. Never treat your own answer as verified evidence.",
    messages: assistantContent ? [{ role: "user", content: prompt }, { role: "assistant", content: assistantContent }] : [{ role: "user", content: prompt }],
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: maxSearchUses }]
  };
}
async function callClaudeSearch(prompt, request, assistantContent, maxSearchUses = PRIMARY_SEARCH_USES_PER_BATCH) {
  let response;
  try {
    response = await request(ANTHROPIC_URL2, {
      method: "POST",
      headers: {
        "x-api-key": env("ANTHROPIC_API_KEY") ?? "",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify(claudeRequestBody(prompt, assistantContent, maxSearchUses)),
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS)
    });
  } catch (error) {
    addClaudeUsage(void 0, "basic-facts-search", "failed", error instanceof Error && error.name === "TimeoutError" ? `timeout_${DISCOVERY_TIMEOUT_MS}ms` : "transport_error");
    return null;
  }
  if (!response.ok) {
    addClaudeUsage(void 0, "basic-facts-search", "failed", `http_${response.status}`);
    return null;
  }
  let data;
  try {
    data = await response.json();
  } catch {
    addClaudeUsage(void 0, "basic-facts-search", "failed", "response_json_error");
    return null;
  }
  const text2 = responseText(data);
  addClaudeUsage(
    data.usage,
    "basic-facts-search",
    text2 || data.stop_reason === "pause_turn" ? "succeeded" : "partial",
    text2 || data.stop_reason === "pause_turn" ? void 0 : "empty_output"
  );
  return data;
}
function aggregateGroupStates(states) {
  if (!states.length) return "skipped";
  if (states.every((state) => state === "failed")) return "failed";
  if (states.some((state) => state === "failed" || state === "partial")) return "partial";
  if (states.some((state) => state === "succeeded")) return "succeeded";
  if (states.every((state) => state === "completed_empty")) return "completed_empty";
  return "partial";
}
function aggregateDiscovery(provider, batches) {
  const leads = selectBasicFactLeads(batches.flatMap((batch) => batch.leads));
  const failedBatches = batches.filter((batch) => batch.state === "failed" || batch.state === "partial").length;
  const completedBatches = batches.filter((batch) => batch.state === "succeeded" || batch.state === "completed_empty").length;
  const state = failedBatches ? leads.length || completedBatches ? "partial" : "failed" : leads.length ? "succeeded" : "completed_empty";
  const batchStates = Object.fromEntries(
    ["identity", "track_record", "structure_risk"].flatMap((batch) => {
      const states = batches.filter((result) => result.batch === batch).map((result) => result.state);
      return states.length ? [[batch, aggregateGroupStates(states)]] : [];
    })
  );
  const questionStates = Object.fromEntries(batches.flatMap((batch) => batch.questionSpecific ? batch.questionIds.map((questionId) => [questionId, batch.state]) : []));
  const questionProviders = Object.fromEntries(
    Object.keys(questionStates).map((questionId) => [questionId, provider])
  );
  return {
    provider,
    state,
    leads,
    attempts: batches.reduce((sum, batch) => sum + batch.attempts, 0),
    completedBatches,
    failedBatches,
    batchStates,
    ...Object.keys(questionStates).length ? { questionStates } : {},
    ...Object.keys(questionProviders).length ? { questionProviders } : {},
    detail: batches.map((batch) => batch.detail).filter(Boolean).join("; ") || void 0
  };
}
function questionSearchGroups(questions, phase) {
  const batches = ["identity", "track_record", "structure_risk"];
  const isolateQuestion = (question) => phase === "repair" || supportsExplicitEmptyBasicFact(question.predicate) && questions.length === 1;
  const grouped = batches.flatMap((batch) => {
    const selected = questions.filter((question) => question.batch === batch && !isolateQuestion(question));
    return selected.length ? [{ key: batch, batch, questions: selected, questionSpecific: false }] : [];
  });
  const targeted = questions.filter(isolateQuestion).map((question) => ({
    key: question.id,
    batch: question.batch,
    questions: [question],
    questionSpecific: true
  }));
  return [...grouped, ...targeted];
}
async function mapDiscoveryGroups(groups, work) {
  if (!groups.length) return [];
  const output = new Array(groups.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(DISCOVERY_BATCH_CONCURRENCY, groups.length) },
    async () => {
      while (cursor < groups.length) {
        const index = cursor;
        cursor += 1;
        output[index] = await work(groups[index]);
      }
    }
  );
  await Promise.all(workers);
  return output;
}
async function discoverBasicFactLeadsDetailed(ctx, dependencies = {}, questions = basicFactsResearchQuestions(ctx), phase = "primary") {
  if (!env("ANTHROPIC_API_KEY") && !dependencies.request) {
    return { provider: "claude-web-search", state: "skipped", leads: [], attempts: 0, completedBatches: 0, failedBatches: 0, detail: "Claude search is not configured" };
  }
  const canonicalSubject = subjectName(ctx);
  const cacheRead = dependencies.cacheRead ?? ((key) => cacheGet(key, { operation: "basic-facts-hit", meta: "24h Claude web-search cache" }));
  const cacheWrite = dependencies.cacheWrite ?? cacheSet;
  const request = dependencies.request ?? fetch;
  const audience = questions[0]?.audience ?? researchAudience(ctx);
  const grouped = questionSearchGroups(questions, phase);
  let providerHttpCalls = 0;
  let providerCallBudgetExhausted = false;
  const batches = await mapDiscoveryGroups(grouped, async ({ key, batch, questions: batchQuestions, questionSpecific }) => {
    const group = {
      key,
      batch,
      questionIds: batchQuestions.map((question) => question.id),
      questionSpecific
    };
    const questionFingerprint = createHash4("sha256").update(batchQuestions.map((question) => question.id).sort().join("|")).digest("hex").slice(0, 12);
    const cacheKey = `basic-facts:${RESEARCH_CACHE_VERSION}:claude:${audience}:${phase}:${key}:${questionFingerprint}:${ctx.handle.toLowerCase()}:${canonicalSubject.toLowerCase()}:${ctx.evidence.profile.website ?? ""}`;
    const cached = await cacheRead(cacheKey);
    if (cached) {
      const parsed2 = parseBasicFactLeads(cached, canonicalSubject, "claude-web-search", batchQuestions);
      const rawFactCount2 = rawBasicFactCount(cached);
      if (parsed2?.length || parsed2 && !questionSpecific) return {
        ...group,
        state: parsed2.length ? "succeeded" : rawFactCount2 === 0 ? "completed_empty" : "partial",
        leads: parsed2,
        attempts: 0,
        detail: `${key}:cache_${parsed2.length ? "hit" : rawFactCount2 === 0 ? "explicit_empty" : "nonempty_filtered"}`
      };
    }
    const prompt = discoveryPrompt(ctx, batchQuestions, phase);
    const maxSearchUses = phase === "repair" ? REPAIR_SEARCH_USES : PRIMARY_SEARCH_USES_PER_BATCH;
    const executeSearch = async () => {
      let attempts2 = 0;
      const invoke = async (assistantContent) => {
        if (phase === "repair" && providerHttpCalls >= MAX_REPAIR_PROVIDER_CALLS) {
          providerCallBudgetExhausted = true;
          return null;
        }
        providerHttpCalls += 1;
        attempts2 += 1;
        return callClaudeSearch(prompt, request, assistantContent, maxSearchUses);
      };
      let response = await invoke();
      if (!response) return { search: null, attempts: attempts2 };
      let webSearchRequests2 = response.usage?.server_tool_use?.web_search_requests ?? 0;
      if (response.stop_reason === "pause_turn" && response.content?.length) {
        response = await invoke(response.content);
        if (!response) return { search: null, attempts: attempts2 };
        webSearchRequests2 += response.usage?.server_tool_use?.web_search_requests ?? 0;
      }
      return { search: { response, webSearchRequests: webSearchRequests2 }, attempts: attempts2 };
    };
    const execution = await executeSearch();
    let search = execution.search;
    let attempts = execution.attempts;
    let text2 = search ? responseText(search.response) : "";
    let parsed = text2 ? parseBasicFactLeads(text2, canonicalSubject, "claude-web-search", batchQuestions) : null;
    if (!search || !text2 || !parsed) {
      await new Promise((resolve) => setTimeout(resolve, DISCOVERY_RETRY_DELAY_MS));
      const retry = await executeSearch();
      attempts += retry.attempts;
      if (retry.search) {
        search = retry.search;
        text2 = responseText(retry.search.response);
        parsed = text2 ? parseBasicFactLeads(text2, canonicalSubject, "claude-web-search", batchQuestions) : null;
      }
    }
    if (!search) return { ...group, state: "failed", leads: [], attempts, detail: `${key}:request_failed_after_retry` };
    if (!text2) return { ...group, state: "partial", leads: [], attempts, detail: `${key}:empty_output_after_retry` };
    if (!parsed) return { ...group, state: "partial", leads: [], attempts, detail: `${key}:invalid_json_after_retry` };
    const webSearchRequests = search.webSearchRequests;
    void cacheWrite(cacheKey, text2);
    const rawFactCount = rawBasicFactCount(text2);
    const explicitEmpty = rawFactCount === 0;
    const attributableEmpty = !parsed.length && explicitEmpty && (!questionSpecific || webSearchRequests > 0);
    return {
      ...group,
      state: parsed.length ? "succeeded" : attributableEmpty ? "completed_empty" : "partial",
      leads: parsed,
      attempts,
      detail: `${key}:${parsed.length ? `${parsed.length}_leads` : attributableEmpty ? `completed_empty_${webSearchRequests}_searches` : rawFactCount !== null && rawFactCount > 0 ? `partial_${rawFactCount}_raw_facts_filtered` : "empty_without_attributable_search"}`
    };
  });
  const result = aggregateDiscovery("claude-web-search", batches);
  if (providerCallBudgetExhausted) {
    result.detail = [result.detail, `repair provider-call budget exhausted at ${MAX_REPAIR_PROVIDER_CALLS} calls`].filter(Boolean).join("; ");
  }
  return result;
}
async function discoverGrokBasicFactLeadsDetailed(ctx, questions, phase, options = {}) {
  if (!env("XAI_API_KEY")) {
    return { provider: "grok", state: "skipped", leads: [], attempts: 0, completedBatches: 0, failedBatches: 0, detail: "Grok search is not configured" };
  }
  const audience = questions[0]?.audience ?? researchAudience(ctx);
  const grouped = questionSearchGroups(questions, phase);
  let providerHttpCalls = 0;
  let providerCallBudgetExhausted = false;
  const claimProviderCall = () => {
    if (phase !== "repair") return true;
    if (providerHttpCalls >= MAX_REPAIR_PROVIDER_CALLS) {
      providerCallBudgetExhausted = true;
      return false;
    }
    providerHttpCalls += 1;
    return true;
  };
  const batches = await mapDiscoveryGroups(grouped, async ({ key, batch, questions: batchQuestions, questionSpecific }) => {
    const group = {
      key,
      batch,
      questionIds: batchQuestions.map((question) => question.id),
      questionSpecific
    };
    const fingerprint = createHash4("sha256").update(batchQuestions.map((question) => question.id).sort().join("|")).digest("hex").slice(0, 12);
    let attempts = 0;
    const text2 = await grokSearch(
      "You are ARGUS's basic-facts research scout. Use live web search. Return only the requested JSON. Every answer remains an unverified lead until ARGUS fetches and verifies the exact source passage.",
      discoveryPrompt(ctx, batchQuestions, phase),
      {
        maxToolCalls: phase === "repair" ? REPAIR_SEARCH_USES : PRIMARY_SEARCH_USES_PER_BATCH,
        cacheKey: `basic-facts:${RESEARCH_CACHE_VERSION}:grok:${audience}:${phase}:${key}:${fingerprint}:${ctx.handle.toLowerCase()}:${subjectName(ctx).toLowerCase()}`,
        bypassCache: options.bypassCache,
        claimProviderCall: () => {
          const claimed = claimProviderCall();
          if (claimed) attempts += 1;
          return claimed;
        }
      }
    );
    if (!text2) return { ...group, state: "failed", leads: [], attempts, detail: `${key}:request_failed` };
    const parsed = parseBasicFactLeads(text2, subjectName(ctx), "grok", batchQuestions);
    if (!parsed) return { ...group, state: "partial", leads: [], attempts, detail: `${key}:invalid_json` };
    return {
      ...group,
      // grokSearch currently exposes text but not attributable tool-use
      // telemetry. An empty targeted answer therefore stays partial rather
      // than becoming a checked-empty claim.
      state: parsed.length ? "succeeded" : questionSpecific ? "partial" : "completed_empty",
      leads: parsed,
      attempts,
      detail: `${key}:${parsed.length ? `${parsed.length}_leads` : questionSpecific ? "empty_without_attributable_search" : "completed_empty"}`
    };
  });
  const result = aggregateDiscovery("grok", batches);
  if (providerCallBudgetExhausted) {
    result.detail = [result.detail, `repair provider-call budget exhausted at ${MAX_REPAIR_PROVIDER_CALLS} calls`].filter(Boolean).join("; ");
  }
  return result;
}
async function discoverPrimary(ctx, questions) {
  if (!env("ANTHROPIC_API_KEY")) return discoverGrokBasicFactLeadsDetailed(ctx, questions, "primary");
  const claude = await discoverBasicFactLeadsDetailed(ctx, {}, questions, "primary");
  if (!env("XAI_API_KEY") || claude.state !== "failed" && !(claude.state === "partial" && claude.leads.length === 0)) return claude;
  const grok = await discoverGrokBasicFactLeadsDetailed(ctx, questions, "primary");
  return {
    ...grok,
    // Grok governs this result. Claude's failure stays visible in cost and
    // incident history without mislabeling Grok-discovered leads as Claude.
    attempts: claude.attempts + grok.attempts,
    detail: [
      `Claude primary ${claude.state}: ${claude.detail ?? "no detail"}`,
      `Grok fallback ${grok.state}: ${grok.detail ?? "no detail"}`
    ].join("; ")
  };
}
async function discoverRepair(ctx, questions) {
  if (!questions.length) {
    return { provider: "none", state: "skipped", leads: [], attempts: 0, completedBatches: 0, failedBatches: 0, detail: "no critical gaps" };
  }
  if (env("XAI_API_KEY")) return discoverGrokBasicFactLeadsDetailed(ctx, questions, "repair");
  if (env("ANTHROPIC_API_KEY")) return discoverBasicFactLeadsDetailed(ctx, {}, questions, "repair");
  return { provider: "none", state: "skipped", leads: [], attempts: 0, completedBatches: 0, failedBatches: 0, detail: "no repair search provider configured" };
}
function decodeHtmlEntities(value) {
  const named = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"' };
  return value.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (match, decimal, hex, name) => {
    if (decimal) return String.fromCodePoint(Number.parseInt(decimal, 10));
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
    return name ? named[name.toLowerCase()] ?? match : match;
  });
}
var MAX_JSON_LD_BLOCK_CHARS = 2e5;
var MAX_JSON_LD_TEXT_CHARS = 24e4;
var JSON_LD_OBJECT_BOUNDARY = "ARGUSJSONLDOBJECTBOUNDARY";
var JSON_LD_TEXT_KEYS = /* @__PURE__ */ new Set([
  "alternateName",
  "dateFounded",
  "description",
  "foundingDate",
  "headline",
  "jobTitle",
  "legalName",
  "name",
  "text",
  "tickerSymbol"
]);
var JSON_LD_RELATION_KEYS = /* @__PURE__ */ new Set([
  "affiliation",
  "founder",
  "founders",
  "memberOf",
  "parentOrganization",
  "worksFor"
]);
function extractJsonLdText(html) {
  const objects = [];
  let total = 0;
  const cleanJsonLdText = (value) => value.replace(/<br\s*\/?\s*>|<\/(?:p|div|section|article|li|h[1-6]|blockquote)>/gi, ". ").replace(/<[^>]+>/g, " ").trim().slice(0, 12e3);
  const ownText = (value) => Object.entries(value).flatMap(([key, child]) => typeof child === "string" && JSON_LD_TEXT_KEYS.has(key) ? [cleanJsonLdText(child)].filter(Boolean) : []);
  const stableIdentity = (value) => [
    value.name,
    value.legalName,
    value.alternateName
  ].flatMap((child) => typeof child === "string" ? [cleanJsonLdText(child)].filter(Boolean) : []);
  const emit = (fragments) => {
    if (!fragments.length || total >= MAX_JSON_LD_TEXT_CHARS) return;
    const remaining = MAX_JSON_LD_TEXT_CHARS - total;
    const joined = fragments.join(". ").slice(0, remaining);
    if (!joined) return;
    objects.push(joined);
    total += joined.length;
  };
  const emitObjectPaths = (value, inherited = [], depth = 0) => {
    if (depth > 5 || total >= MAX_JSON_LD_TEXT_CHARS) return;
    const current = [...inherited, ...ownText(value)];
    emit(current);
    const childIdentity = [...inherited, ...stableIdentity(value)];
    for (const [key, child] of Object.entries(value)) {
      if (!JSON_LD_RELATION_KEYS.has(key)) continue;
      const related = Array.isArray(child) ? child : [child];
      for (const item of related) {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          emitObjectPaths(item, childIdentity, depth + 1);
        }
      }
    }
  };
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attributes = match[1] ?? "";
    if (!/\btype\s*=\s*(?:"application\/ld\+json"|'application\/ld\+json'|application\/ld\+json)(?:\s|$)/i.test(attributes)) continue;
    const raw = (match[2] ?? "").trim();
    if (!raw || raw.length > MAX_JSON_LD_BLOCK_CHARS) continue;
    let parsed;
    try {
      parsed = JSON.parse(raw.replace(/^\s*<!--|-->\s*$/g, ""));
    } catch {
      continue;
    }
    const roots = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" && Array.isArray(parsed["@graph"]) ? parsed["@graph"] : [parsed];
    for (const root of roots) {
      if (!root || typeof root !== "object" || Array.isArray(root) || total >= MAX_JSON_LD_TEXT_CHARS) continue;
      emitObjectPaths(root);
    }
  }
  return objects.join(` ${JSON_LD_OBJECT_BOUNDARY} `);
}
function documentText(document) {
  if (!/html|xhtml/i.test(document.contentType)) return normalize(document.text);
  const jsonLd = extractJsonLdText(document.text);
  return normalize(decodeHtmlEntities(`${jsonLd}${jsonLd ? ` ${JSON_LD_OBJECT_BOUNDARY} ` : ""}${document.text.replace(/<(?:script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/(?:script|style|noscript|svg)>/gi, " ").replace(/<!--([\s\S]*?)-->/g, " ").replace(/<br\s*\/?\s*>|<\/(?:p|div|section|article|li|h[1-6]|tr|td|th|main|header|footer|blockquote)>/gi, ". ").replace(/<[^>]+>/g, " ")}`));
}
var PREDICATE_PATTERNS = {
  official_identity: /\b(?:official|known as|operated by|developed by|is (?:a|an|the)|project|organization|protocol|foundation|company|person|entrepreneur|investor|(?:co[- ]?)?founder|chief executive officer|ceo)\b/i,
  current_role: /\b(?:currently|serves as|has served as|works as|is (?:the |an? )?(?:founder|co[- ]?founder|chief|ceo|cto|coo|cfo|president|partner|principal|director|head|lead|chair|member)|(?:co[- ]?founder|chief executive officer|chief technology officer|chief operating officer|chief financial officer|ceo|cto|coo|cfo|president|partner|principal|director|head|lead|chair(?:man|woman|person)?|board member)(?:\s*(?:,|&|and)\s*(?:co[- ]?founder|chief executive officer|chief technology officer|chief operating officer|chief financial officer|ceo|cto|coo|cfo|president|partner|principal|director|head|lead|chair(?:man|woman|person)?|board member))*|current role)\b/i,
  prior_role: /\b(?:formerly|previously|prior to|served as|was (?:the |an? )?(?:founder|co[- ]?founder|chief|ceo|cto|coo|cfo|president|partner|principal|director|head|lead|chair|member)|prior role)\b/i,
  education: /\b(?:graduated|degree|studied|attended|education|university|college|school|bachelor|master(?:'s)?|mba|phd|doctorate)\b/i,
  founder: /\b(?:co[- ]?founders?|founders?|co[- ]?founded|founded(?:\s+by)?)\b/i,
  executive: /\b(?:chief executive officer|chief technology officer|chief operating officer|chief financial officer|ceo|cto|coo|cfo|president|executive|director|head of|lead)\b/i,
  founded: /\b(?:co[- ]?founder|founded|established|formed|incorporated|inception)\b/i,
  launched: /\b(?:launched|went live|debuted|released|introduced)\b/i,
  exit: /\b(?:acquired|acquisition|bought by|sold to|sale of|exited|exit|ipo|public offering|direct listing|went public|listed publicly|shut down|closed)\b/i,
  track_record: /\b(?:track record|outcome|returned|return|revenue|users?|volume|assets under management|aum|built|grew|scaled|founded|invested)\b/i,
  official_token: /\b(?:official token|governance token|native token|utility token|token|ticker|symbol)\b/i,
  public_security: /\b(?:publicly traded|listed (?:on|company)|stock|shares?|equity|debt security|bond|nasdaq|nyse|ticker symbol|initial public offering|ipo)\b/i,
  funding: /\b(?:raised|raises|funding|financing|fundraise|round|capital)\b/i,
  investor: /\b(?:invested|investment|investor|backed|backing|led the round|participated in)\b/i,
  product: /\b(?:product|platform|protocol|service|aggregator|exchange|marketplace|wallet|application|app)\b/i,
  network: /\b(?:blockchain|network|chain|mainnet|built on|deployed on|runs on|(?:on|for)\s+(?:the\s+)?(?:ethereum|solana|polygon|arbitrum|optimism|avalanche|base|bnb(?:\s+chain)?|bitcoin|cosmos|sui|aptos|near|tron|ton|polkadot|cardano))\b/i,
  legal_entity: /\b(?:legal entity|company|corporation|incorporated|foundation|limited|ltd\.?|inc\.?|llc|labs)\b/i,
  legal_regulatory_event: /\b(?:lawsuit|litigation|sued|complaint|settlement|settled|judgment|investigation|enforcement|regulator|regulatory|sec|cftc|doj|ftc|charges?|indictment|dismissed|pending|resolved)\b/i,
  governance: /\b(?:governance|governed|dao|proposal|vote|voting|council|multisig|multi-sig)\b/i,
  control: /\b(?:controls?|ownership|owner|voting power|board seat|director|admin keys?|multisig|multi-sig|signatory|treasury authority)\b/i,
  conflict_of_interest: /\b(?:conflict of interest|related[- ]party|self[- ]dealing|financial interest|disclosed interest|recusal|recused)\b/i,
  tokenomics: /\b(?:tokenomics|token allocation|token distribution|allocation|distribution|emissions?|circulating supply|total supply|max(?:imum)? supply)\b/i,
  vesting: /\b(?:vesting|vested|unlock(?:s|ed|ing)?|cliff|lockup|lock-up|release schedule)\b/i,
  treasury: /\b(?:treasury|reserves?|treasury wallet|treasury report|multisig|multi-sig)\b/i,
  audit: /\b(?:audit|audited|security review|security assessment|formal verification)\b/i,
  repository: /\b(?:github|source code|codebase|repository|repo|open source|open-source)\b/i,
  traction: /\b(?:users?|customers?|volume|tvl|total value locked|transactions?|revenue|fees|usage|adoption|downloads?|active wallets?)\b/i
};
var EXPLICIT_OFFICIAL_CRYPTO_TOKEN = /\b(?:official|governance|native|utility|crypto(?:currency)?)\s+(?:crypto\s+)?token\b/i;
var EXPLICIT_WRAPPED_OR_ERC_TOKEN = /\b(?:wrapped(?:\s+[a-z0-9-]+){0,3}\s+token|erc[- ]?\d+\s+(?:wrapped\s+)?token)\b/i;
function positivePredicateMatches(excerpt, predicate) {
  const pattern = new RegExp(PREDICATE_PATTERNS[predicate].source, "gi");
  return [...excerpt.matchAll(pattern)].filter((match) => {
    if (match.index === void 0) return false;
    const local = excerpt.slice(Math.max(0, match.index - 45), match.index + match[0].length + 45);
    return !/\b(?:not|never|no|without|didn't|did not|denied|false claim)\b/i.test(local);
  });
}
function predicateIsSupported(excerpt, predicate) {
  return positivePredicateMatches(excerpt, predicate).length > 0;
}
var MAX_SUPPORT_PASSAGE_CHARS = 720;
function sourceTokens(value) {
  const tokens = [];
  for (const match of value.matchAll(/[\p{L}\p{N}]+/gu)) {
    if (match.index === void 0) continue;
    const key = looseTokens(match[0])[0];
    if (key) tokens.push({ key, raw: match[0], start: match.index, end: match.index + match[0].length });
  }
  return tokens;
}
function phraseTokenStarts(tokens, phrase) {
  const needle = looseTokens(phrase);
  if (!needle.length || needle.length > tokens.length) return [];
  const starts = [];
  for (let index = 0; index <= tokens.length - needle.length; index += 1) {
    if (needle.every((token, offset) => tokens[index + offset].key === token)) starts.push(index);
  }
  return starts;
}
function exactTokenPassage(page, excerpt) {
  const pageTokens = sourceTokens(page);
  const excerptTokens = looseTokens(excerpt);
  if (!excerptTokens.length || excerptTokens.length > pageTokens.length) return null;
  for (let index = 0; index <= pageTokens.length - excerptTokens.length; index += 1) {
    if (!excerptTokens.every((token, offset) => pageTokens[index + offset].key === token)) continue;
    return normalize(page.slice(pageTokens[index].start, pageTokens[index + excerptTokens.length - 1].end));
  }
  return null;
}
function sourceSegments(page) {
  return page.split(JSON_LD_OBJECT_BOUNDARY).map((segment) => normalize(segment)).filter(Boolean);
}
function sourceSentencePassages(page) {
  const passages = [];
  for (const segment of sourceSegments(page)) {
    const sentences = [...segment.matchAll(/[^.!?]+(?:[.!?]+|$)/g)].flatMap((match) => {
      if (match.index === void 0 || !normalize(match[0])) return [];
      return [{ start: match.index, end: match.index + match[0].length }];
    });
    for (let start = 0; start < sentences.length; start += 1) {
      for (let count = 0; count < 3 && start + count < sentences.length; count += 1) {
        const passage = normalize(segment.slice(sentences[start].start, sentences[start + count].end));
        if (passage.length > MAX_SUPPORT_PASSAGE_CHARS) break;
        passages.push(passage);
      }
    }
  }
  return passages;
}
function sourceAnchorPassages(page, value) {
  return sourceSegments(page).flatMap((segment) => {
    const tokens = sourceTokens(segment);
    const valueTokens = looseTokens(value);
    if (!valueTokens.length) return [];
    return phraseTokenStarts(tokens, value).map((start) => {
      const from = Math.max(0, start - 28);
      const to = Math.min(tokens.length - 1, start + valueTokens.length - 1 + 28);
      return normalize(segment.slice(tokens[from].start, tokens[to].end));
    }).filter((passage) => passage.length <= MAX_SUPPORT_PASSAGE_CHARS);
  });
}
var EMPTY_CONTEXT_TOKENS = /* @__PURE__ */ new Set();
var DIRECT_RELATION_PREDICATES = /* @__PURE__ */ new Set([
  "current_role",
  "prior_role",
  "founder",
  "executive"
]);
var RELATION_CHAIN_PREDICATES = /* @__PURE__ */ new Set([
  "founded",
  "product",
  "exit",
  "track_record",
  "public_security"
]);
var RELATION_LANGUAGE = /\b(?:co[- ]?found(?:er|ed)|found(?:er|ed)|chief executive officer|ceo|chair(?:man|woman|person)?|board member|led|leads|built|created|started|works? (?:at|for)|served? (?:at|as)|controls?)\b/i;
var NON_ENTITY_ANCHORS = /* @__PURE__ */ new Set([
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december"
]);
function individualSentences(value) {
  const marker2 = "ARGUSABBREVIATIONDOT";
  const protectedValue = value.replace(
    /\b(?:Mr|Mrs|Ms|Dr|Inc|Ltd|Corp|Co|No|U\.S)\./g,
    (match) => match.replace(/\./g, marker2)
  );
  return [...protectedValue.matchAll(/[^.!?]+(?:[.!?]+|$)/g)].map((match) => normalize(match[0].replaceAll(marker2, "."))).filter(Boolean);
}
function attributionClauses(value) {
  return individualSentences(value).flatMap((sentence) => sentence.split(/\s*(?:;|,\s*(?:and|but|while|whereas|which|who|that)|\s+(?:but|while|whereas)\s+)\s*/i).flatMap((clause) => clause.split(
    /\s+and\s+(?=(?:(?:[A-Z][A-Za-z0-9.'’-]*)\s+){0,3}(?:[A-Z][A-Za-z0-9.'’-]*)\s+(?:is|was|has|had|serves?|served|settled|reported|announced|founded|co[- ]?founded|leads?|led|works?|worked|went|became)\b)/
  )).flatMap((clause) => clause.split(
    /\s+and\s+(?=(?:founded|co[- ]?founded|serves?|served|works?|worked|reported|announced|settled|went|became|launched|built|created|led|leads)\b)/i
  )).map(normalize).filter(Boolean));
}
function hasSubjectAlias(value, aliases) {
  if (aliases.some((alias) => looseContainsPhrase(value, alias))) return true;
  return aliases.some((alias) => {
    const tokens = looseTokens(alias);
    if (tokens.length < 2) return false;
    const surname = tokens[tokens.length - 1];
    return ["mr", "mrs", "ms", "dr"].some((honorific) => looseContainsPhrase(value, `${honorific} ${surname}`));
  });
}
var MATERIAL_ROLE_TOKENS = /* @__PURE__ */ new Set([
  "adviser",
  "advisor",
  "ceo",
  "cfo",
  "coo",
  "cto",
  "chair",
  "director",
  "engineer",
  "founder",
  "head",
  "investor",
  "lead",
  "manager",
  "member",
  "partner",
  "president",
  "principal"
]);
var NON_PERSON_TITLE_TOKENS = /* @__PURE__ */ new Set([
  "and",
  "at",
  "chief",
  "co",
  "company",
  "corp",
  "corporation",
  "exchange",
  "global",
  "group",
  "host",
  "inc",
  "llc",
  "ltd",
  "nasdaq",
  "nyse",
  "of",
  "officer",
  "spaces",
  "the",
  "to",
  "with",
  ...MATERIAL_ROLE_TOKENS
]);
function roleMatchAt(tokens, index) {
  const keys = tokens.slice(index, index + 3).map((token) => token.key);
  const phrase = keys.join(" ");
  const expanded = (/* @__PURE__ */ new Map([
    ["chief executive officer", "ceo"],
    ["chief financial officer", "cfo"],
    ["chief operating officer", "coo"],
    ["chief technology officer", "cto"]
  ])).get(phrase);
  if (expanded) return { role: expanded, start: index, end: index + 2 };
  const shortened = (/* @__PURE__ */ new Map([
    ["chief executive", "ceo"],
    ["chief financial", "cfo"],
    ["chief operating", "coo"],
    ["chief technology", "cto"]
  ])).get(keys.slice(0, 2).join(" "));
  if (shortened) return { role: shortened, start: index, end: index + 1 };
  if (tokens[index]?.key === "co" && tokens[index + 1]?.key === "founder") {
    return { role: "founder", start: index, end: index + 1 };
  }
  if (tokens[index]?.key === "board" && tokens[index + 1]?.key === "member") {
    return { role: "member", start: index, end: index + 1 };
  }
  if (tokens[index]?.key === "software" && tokens[index + 1]?.key === "engineer") {
    return { role: "engineer", start: index, end: index + 1 };
  }
  const direct = tokens[index]?.key;
  return direct && MATERIAL_ROLE_TOKENS.has(direct) ? { role: direct, start: index, end: index } : null;
}
function roleMatches(tokens) {
  const matches = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const match = roleMatchAt(tokens, index);
    if (!match) continue;
    matches.push(match);
    index = match.end;
  }
  return matches;
}
function subjectTokenSpans(tokens, aliases) {
  const spans = [];
  for (const alias of aliases) {
    const aliasTokens = looseTokens(alias);
    for (const start of phraseTokenStarts(tokens, alias)) {
      spans.push({ start, end: start + aliasTokens.length - 1 });
    }
    if (aliasTokens.length < 2) continue;
    const surname = aliasTokens.at(-1);
    for (let index = 0; index < tokens.length - 1; index += 1) {
      if (["mr", "mrs", "ms", "dr"].includes(tokens[index].key) && tokens[index + 1].key === surname) {
        spans.push({ start: index, end: index + 1 });
      }
    }
  }
  return spans;
}
function probablePersonSpans(tokens, excludedEntityTokens = EMPTY_CONTEXT_TOKENS) {
  const capitalized = (token) => {
    if (!token) return false;
    return new RegExp("^\\p{Lu}[\\p{L}\\p{M}'\u2019-]+$", "u").test(token.raw) && token.raw.length > 1 && !NON_PERSON_TITLE_TOKENS.has(token.key) && !excludedEntityTokens.has(token.key);
  };
  const roles = roleMatches(tokens);
  const spans = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (!capitalized(tokens[index])) continue;
    const precededByRole = roles.some((role) => role.end === index - 1);
    const followedByRole = ["is", "was", "serves", "served"].includes(tokens[index + 1]?.key ?? "") && roles.some((role) => role.start >= index + 2 && role.start <= index + 5);
    const twoTokenName = capitalized(tokens[index + 1]);
    if (!twoTokenName && !precededByRole && !followedByRole) continue;
    if (!precededByRole && index > 0 && ["at", "for", "from", "of", "to", "with"].includes(tokens[index - 1].key)) continue;
    let end = index;
    while (end + 1 < tokens.length && end - index < 3 && capitalized(tokens[end + 1])) end += 1;
    spans.push({ start: index, end });
    index = end;
  }
  return spans;
}
function executivePersonAliases(lead, projectAliases) {
  const excluded = /* @__PURE__ */ new Set([
    ...ROLE_DESCRIPTOR_TOKENS,
    ...projectAliases.flatMap(looseTokens),
    "and",
    "at",
    "by",
    "for",
    "of",
    "the",
    "with"
  ]);
  const personTokens = looseTokens(lead.value).filter((token) => !excluded.has(token));
  return personTokens.length ? [personTokens.join(" ")] : [];
}
function roleAttributionIsSupported(clause, lead, aliases) {
  if (!["current_role", "prior_role", "executive"].includes(lead.predicate)) return true;
  const requestedRoles = [...new Set(roleMatches(sourceTokens(lead.value)).map((role) => role.role))];
  if (!requestedRoles.length) return false;
  const tokens = sourceTokens(clause);
  const targetAliases = lead.predicate === "executive" ? executivePersonAliases(lead, aliases) : aliases;
  const subjectSpans = subjectTokenSpans(tokens, targetAliases);
  if (!subjectSpans.length) return false;
  const excludedEntityTokens = /* @__PURE__ */ new Set([
    ...valueAnchorTokens(lead),
    ...lead.predicate === "executive" ? aliases.flatMap(looseTokens) : []
  ]);
  const allPeople = [...subjectSpans.map((span) => ({ ...span, subject: true })), ...probablePersonSpans(tokens, excludedEntityTokens).filter((person) => !subjectSpans.some((subject) => person.start === subject.start && person.end === subject.end)).map((span) => ({ ...span, subject: false }))];
  const roles = roleMatches(tokens);
  const distance = (role, span) => role.end < span.start ? span.start - role.end : role.start > span.end ? role.start - span.end : 0;
  if (/\brespectively\b/i.test(clause)) {
    const firstRoleStart = roles[0]?.start ?? Number.POSITIVE_INFINITY;
    const orderedPeople = allPeople.filter((person) => person.end < firstRoleStart).sort((left, right) => left.start - right.start).filter((person, index, people) => index === 0 || person.start !== people[index - 1].start || person.end !== people[index - 1].end);
    if (orderedPeople.length >= requestedRoles.length && roles.length >= requestedRoles.length) {
      return requestedRoles.every((requestedRole) => roles.some((role, roleIndex) => role.role === requestedRole && orderedPeople[roleIndex]?.subject));
    }
  }
  return requestedRoles.every((requestedRole) => roles.some((role) => {
    if (role.role !== requestedRole) return false;
    const following = allPeople.filter((person) => person.start > role.end && person.start - role.end <= 5).filter((person) => tokens.slice(role.end + 1, person.start).every((between) => between.key === "and" || between.key === "co" || between.key === "chief" || between.key === "executive" || between.key === "financial" || between.key === "operating" || between.key === "technology" || between.key === "officer" || MATERIAL_ROLE_TOKENS.has(between.key))).sort((left, right) => left.start - right.start)[0];
    if (following) return following.subject;
    const nearest = allPeople.slice().sort((left, right) => distance(role, left) - distance(role, right) || Number(right.subject) - Number(left.subject))[0];
    return Boolean(nearest?.subject && distance(role, nearest) <= 16);
  }));
}
function titleBindsOfficialIdentity(clause, lead) {
  if (looseTokens(lead.value).length < 2) return false;
  const tokens = sourceTokens(clause);
  const identityTokenKeys = new Set(looseTokens(lead.value));
  const identitySpans = phraseTokenStarts(tokens, lead.value).map((start) => ({
    start,
    end: start + looseTokens(lead.value).length - 1
  }));
  const directAfterLinkers = /* @__PURE__ */ new Set([
    "",
    "a",
    "an",
    "as",
    "is",
    "is the",
    "served as",
    "serves as",
    "the",
    "was",
    "was the"
  ]);
  const otherPeople = probablePersonSpans(tokens, identityTokenKeys);
  return identitySpans.some((identity) => roleMatches(tokens).some((role) => {
    if (role.end < identity.start) {
      return role.end === identity.start - 1;
    }
    if (role.start > identity.end) {
      const linker = tokens.slice(identity.end + 1, role.start).map((token) => token.key).join(" ");
      if (!directAfterLinkers.has(linker)) return false;
      return !otherPeople.some((person) => person.start > role.end && person.start - role.end <= 3);
    }
    return false;
  }));
}
function explicitPersonIdentityIsBound(clause, lead) {
  const value = loosePhrasePattern(lead.value);
  if (!value) return false;
  return [
    new RegExp(`\\b(?:official(?:\\s+(?:name|identity))?|known\\s+as)\\b[^.!?;]{0,48}\\b${value}\\b`, "i"),
    new RegExp(`\\b${value}\\b\\s*,?\\s*(?:(?:is|was)\\s+)?(?:an?\\s+|the\\s+)?(?:entrepreneur|investor|person)\\b`, "i")
  ].some((pattern) => pattern.test(clause));
}
function loosePhrasePattern(value) {
  return looseTokens(value).map(escapedPattern).join("\\W+");
}
var FOUNDER_ENTITY_CONTINUATION_TOKENS = /* @__PURE__ */ new Set([
  "capital",
  "company",
  "corp",
  "corporation",
  "dao",
  "ecosystem",
  "exchange",
  "foundation",
  "global",
  "group",
  "holdings",
  "inc",
  "labs",
  "limited",
  "llc",
  "ltd",
  "network",
  "organization",
  "platform",
  "plc",
  "protocol",
  "technologies",
  "technology",
  "ventures"
]);
function founderValueHasExactEntityBoundary(clause, value) {
  const tokens = sourceTokens(clause);
  const starts = phraseTokenStarts(tokens, value);
  if (!starts.length) return false;
  const valueLength = looseTokens(value).length;
  return starts.every((start) => {
    const end = start + valueLength - 1;
    const current = tokens[end];
    const next = tokens[end + 1];
    if (!current || !next) return true;
    const separator = clause.slice(current.end, next.start);
    if (/[,.;:!?)]/.test(separator)) return true;
    if (["and", "but", "while", "whereas"].includes(next.key)) return true;
    if (FOUNDER_ENTITY_CONTINUATION_TOKENS.has(next.key)) return false;
    return !new RegExp("^\\p{Lu}[\\p{L}\\p{M}'\u2019-]+$", "u").test(next.raw);
  });
}
function founderAttributionIsSupported(passage, lead, aliases) {
  const value = loosePhrasePattern(lead.value);
  if (!value) return false;
  const aliasPatterns = aliases.map(loosePhrasePattern).filter(Boolean);
  const founded = "(?:co[-\\s]?founded|founded)";
  const founder = "(?:co[-\\s]?founder|founder)";
  const founderExecutiveTitle = "(?:\\s*,?\\s*(?:and|&)\\s*(?:the\\s+)?(?:chief\\s+executive\\s+officer|ceo))?";
  const exactVentureBoundary = "(?=\\s*(?:[,.;:!?)]|$))";
  const generic = "(?:the|this|our)\\s+(?:business|company|exchange|organization|platform|product|project|protocol|service|venture)";
  return attributionClauses(passage).some((clause) => {
    if (!founderValueHasExactEntityBoundary(clause, lead.value)) return false;
    const hasProjectContext = aliases.some((alias) => looseContainsPhrase(passage, alias));
    if (hasProjectContext && [
      new RegExp(`\\b${generic}\\b[^.!?;]{0,40}\\b${founded}\\s+by\\s+${value}\\b`, "i"),
      new RegExp(`\\b${value}\\b[^.!?;]{0,25}\\b${founded}\\s+(?:the\\s+)?${generic}\\b`, "i"),
      new RegExp(`\\b${value}\\b[^.!?;]{0,25}\\b(?:is|was)\\s+(?:an?\\s+|the\\s+)?${founder}\\s+of\\s+${generic}\\b`, "i")
    ].some((pattern) => pattern.test(clause))) return true;
    return aliasPatterns.some((subject) => {
      const list = new RegExp(`\\b${subject}\\b(?:['\u2019]s)?[^.!?;]{0,24}\\b${founder}s\\b\\s*(?:(?:include|are)\\s+|:\\s*)?([^.!?;]+)`, "i").exec(clause);
      if (list?.[1] && looseContainsPhrase(list[1], lead.value)) {
        const valueMatch = new RegExp(`\\b${value}\\b`, "i").exec(list[1]);
        const prefix = valueMatch?.index === void 0 ? "" : list[1].slice(Math.max(0, valueMatch.index - 36), valueMatch.index);
        const explicitlyDifferentRole = /\b(?:adviser|advisor|ceo|cfo|coo|cto|director|employee|engineer|head|investor|lead|manager|member|partner|president|principal)\s*(?:,|and|&)?\s*$/i.test(prefix);
        if (!explicitlyDifferentRole) return true;
      }
      return [
        new RegExp(`\\b${subject}\\b(?:['\u2019]s)?\\s+${founder}\\s+(?:is\\s+)?${value}\\b`, "i"),
        new RegExp(`\\b${value}\\b\\s*,?\\s*(?:is\\s+)?(?:an?\\s+|the\\s+)?${founder}\\s+of\\s+(?:the\\s+)?${subject}\\b`, "i"),
        new RegExp(`\\b${subject}\\b[^.!?;]{0,60}\\b${founded}\\s+by\\s+${value}\\b`, "i"),
        new RegExp(`\\b${subject}\\b[^.!?;]{0,40}\\b${founded}\\s+(?:the\\s+)?${value}\\b`, "i"),
        new RegExp(`\\b${subject}\\b\\s+(?:is|was)\\s+(?:an?\\s+|the\\s+)?${founder}${founderExecutiveTitle}\\s+(?:of|at)\\s+(?:the\\s+)?${value}\\b${exactVentureBoundary}`, "i"),
        new RegExp(`\\b${subject}\\b\\s*,\\s*(?:an?\\s+|the\\s+)?${founder}${founderExecutiveTitle}\\s+(?:of|at)\\s+(?:the\\s+)?${value}\\b${exactVentureBoundary}`, "i"),
        new RegExp(`\\b${subject}\\b[^.!?;]{0,40}\\b(?:is|was)\\s+(?:an?\\s+|the\\s+)?${founder}\\s+(?:of|at)\\s+${value}\\b`, "i"),
        new RegExp(`\\b${value}\\b[^.!?;]{0,40}\\b${founded}\\s+(?:the\\s+)?${subject}\\b`, "i"),
        new RegExp(`\\b${value}\\b[^.!?;]{0,40}\\b(?:is|was)\\s+(?:an?\\s+|the\\s+)?${founder}\\s+(?:of|at)\\s+${subject}\\b`, "i")
      ].some((pattern) => pattern.test(clause));
    });
  });
}
function valueAnchorTokens(lead) {
  const descriptors = VALUE_DESCRIPTOR_TOKENS[lead.predicate] ?? /* @__PURE__ */ new Set();
  const ticker = lead.predicate === "public_security" ? primaryTickerCandidate(lead.value) : null;
  return canonicalValueTokens(lead.value).filter((token) => !descriptors.has(token) && !PUBLIC_SECURITY_CORPORATE_MODIFIERS.has(token) && !NON_ENTITY_ANCHORS.has(token) && !/^\d/.test(token) && token !== ticker?.toLowerCase());
}
function safeHostContextForSentence(sentence, trustedContextTokens) {
  if (!trustedContextTokens.size || !/\b(?:our|we|us)\b/i.test(sentence)) return EMPTY_CONTEXT_TOKENS;
  const namedOrganizations = [...sentence.matchAll(
    /(?:\b(?:at|for|of|with)\s+(?:(?:our|the)\s+)?|,\s*(?:the\s+)?)([A-Z][A-Za-z0-9.-]{2,})/g
  )].map((match) => looseTokens(match[1])[0]).filter(Boolean);
  return namedOrganizations.some((token) => !trustedContextTokens.has(token)) ? EMPTY_CONTEXT_TOKENS : trustedContextTokens;
}
function sentenceValueIsSupported(sentence, lead, trustedContextTokens) {
  const safeContext = safeHostContextForSentence(sentence, trustedContextTokens);
  return looseContainsPhrase(sentence, lead.value) || structuredValueIsSupported(sentence, lead, safeContext);
}
var OFFICIAL_SELF_REFERENCE = /\b(?:we|it|our\s+(?:business|company|exchange|organization|platform|product|project|protocol|service|venture)|(?:the|this)\s+(?:business|company|exchange|organization|platform|product|project|protocol|service|venture))\b/i;
var SUBJECT_SWITCH_LANGUAGE = /\b(?:and|with|adviser|advisor|affiliate|announc(?:e[ds]?|ement)|client|confirm(?:s|ed)?|customer|director|employee|integration\s+partner|investor|member|partner|portfolio\s+company|report(?:s|ed)?|sa(?:id|ys)|stat(?:e[ds]?)|subsidiary|vendor)\b/gi;
var OWNERSHIP_SWITCH_LANGUAGE = /^(?:adviser|advisor|affiliate|client|customer|director|employee|integration\s+partner|investor|member|partner|portfolio\s+company|subsidiary|vendor)$/i;
function segmentIntroducesNamedActor(segment, lead) {
  const allowedTokens = /* @__PURE__ */ new Set([
    ...canonicalValueTokens(lead.value),
    ...VALUE_DESCRIPTOR_TOKENS[lead.predicate] ?? [],
    "a",
    "an",
    "approval",
    "as",
    "at",
    "by",
    "completion",
    "for",
    "from",
    "in",
    "its",
    "of",
    "on",
    "own",
    "record",
    "the",
    "that",
    "to"
  ]);
  for (const match of segment.matchAll(SUBJECT_SWITCH_LANGUAGE)) {
    if (match.index === void 0) continue;
    if (OWNERSHIP_SWITCH_LANGUAGE.test(match[0])) return true;
    const after = segment.slice(match.index + match[0].length, match.index + match[0].length + 96);
    if (/^\s*(?:[,:'’s-]+\s*)?(?:that\s+)?(?:it|its|we|our|the\s+(?:business|company|exchange|organization|platform|product|project|protocol|service|venture))\b/i.test(after)) continue;
    const unexpected = looseTokens(after).filter((token) => !/^\d/.test(token) && !allowedTokens.has(token));
    if (unexpected.length) return true;
  }
  return false;
}
function claimTailTransfersOwnership(clause, lead) {
  const matches = positivePredicateMatches(clause, lead.predicate);
  const firstMatch = matches[0];
  if (firstMatch?.index === void 0) return false;
  const tail = clause.slice(firstMatch.index + firstMatch[0].length);
  const allowed = /* @__PURE__ */ new Set([
    ...canonicalValueTokens(lead.value),
    ...VALUE_DESCRIPTOR_TOKENS[lead.predicate] ?? [],
    "april",
    "august",
    "calendar",
    "day",
    "daily",
    "december",
    "ended",
    "ending",
    "february",
    "fiscal",
    "january",
    "july",
    "june",
    "march",
    "may",
    "month",
    "monthly",
    "november",
    "october",
    "september",
    "period",
    "q1",
    "q2",
    "q3",
    "q4",
    "quarter",
    "quarterly",
    "the",
    "week",
    "year",
    "yearly"
  ]);
  for (const match of tail.matchAll(/\b(?:for|generated\s+by|on\s+behalf\s+of|belonging\s+to|attributed\s+to)\b/gi)) {
    if (match.index === void 0) continue;
    const after = tail.slice(match.index + match[0].length, match.index + match[0].length + 96);
    if (/^\s*(?:it|its|our|the\s+(?:business|company|exchange|organization|platform|product|project|protocol|service|venture))\b/i.test(after)) continue;
    const unexpected = looseTokens(after).filter((token) => !/^\d/.test(token) && !allowed.has(token));
    if (unexpected.length) return true;
  }
  return false;
}
function subjectAliasAvoidsTransfer(clause, lead, alias) {
  const aliasPattern = new RegExp(`\\b${loosePhrasePattern(alias)}\\b`, "i");
  const aliasMatch = aliasPattern.exec(clause);
  if (!aliasMatch || aliasMatch.index === void 0) return false;
  const aliasEnd = aliasMatch.index + aliasMatch[0].length;
  if (/\baccording\s+to\s*$/i.test(clause.slice(Math.max(0, aliasMatch.index - 32), aliasMatch.index))) return false;
  return positivePredicateMatches(clause, lead.predicate).some((predicateMatch) => {
    if (predicateMatch.index === void 0) return false;
    if (predicateMatch.index < aliasMatch.index) {
      const between = clause.slice(predicateMatch.index + predicateMatch[0].length, aliasMatch.index);
      return lead.predicate === "funding" && /\bby\s*$/i.test(between) || lead.predicate === "official_token" && /\bof\s*$/i.test(between);
    }
    return !segmentIntroducesNamedActor(clause.slice(aliasEnd, predicateMatch.index), lead);
  });
}
function subjectComparisonIsDisqualified(clause, subject) {
  const pattern = loosePhrasePattern(subject);
  if (!pattern) return true;
  return [
    new RegExp(`\\b(?:unlike|versus|vs\\.?|against|not)\\s+${pattern}\\b`, "i"),
    new RegExp(`\\b${pattern}\\b\\s+(?:competitor|rival)\\s+`, "i"),
    new RegExp(`\\b${pattern}\\b\\s+(?:and|with)\\s+[A-Z][A-Za-z0-9.'\u2019-]+\\s+(?:reported|raised|is|was|has|had|uses|launched|completed|published|deployed|runs|settled|listed)\\b`, "i")
  ].some((candidate) => candidate.test(clause));
}
function directClaimClause(clauses, lead, aliases, trustedContextTokens) {
  const direct = clauses.find((clause) => hasSubjectAlias(clause, aliases) && aliases.every((alias) => !looseContainsPhrase(clause, alias) || !subjectComparisonIsDisqualified(clause, alias)) && (DIRECT_RELATION_PREDICATES.has(lead.predicate) || aliases.some((alias) => subjectAliasAvoidsTransfer(clause, lead, alias))) && sentenceValueIsSupported(clause, lead, trustedContextTokens) && predicateIsSupported(clause, lead.predicate) && !claimTailTransfersOwnership(clause, lead) && roleAttributionIsSupported(clause, lead, aliases));
  if (direct) return direct;
  if (!trustedContextTokens.size) return null;
  return clauses.find((clause) => OFFICIAL_SELF_REFERENCE.test(clause) && !/\b(?:competitor|rival|unlike|versus|vs\.)\b/i.test(clause) && aliases.every((alias) => !looseContainsPhrase(clause, alias) || subjectAliasAvoidsTransfer(clause, lead, alias)) && !segmentIntroducesNamedActor(clause.slice(OFFICIAL_SELF_REFERENCE.exec(clause)?.index ?? 0), lead) && !claimTailTransfersOwnership(clause, lead) && sentenceValueIsSupported(clause, lead, trustedContextTokens) && predicateIsSupported(clause, lead.predicate)) ?? null;
}
function anchorGovernsClaimClause(clause, lead, anchor) {
  if (subjectComparisonIsDisqualified(clause, anchor) || !sentenceValueIsSupported(clause, lead, EMPTY_CONTEXT_TOKENS) || !predicateIsSupported(clause, lead.predicate)) return false;
  if (claimTailTransfersOwnership(clause, lead)) return false;
  const anchorPattern = new RegExp(`\\b${loosePhrasePattern(anchor)}\\b`, "i");
  const anchorMatch = anchorPattern.exec(clause);
  if (!anchorMatch || anchorMatch.index === void 0) return false;
  const anchorStart = anchorMatch.index;
  const anchorEnd = anchorStart + anchorMatch[0].length;
  for (const predicateMatch of positivePredicateMatches(clause, lead.predicate)) {
    if (predicateMatch.index === void 0) continue;
    const predicateStart = predicateMatch.index;
    if (predicateStart >= anchorStart && predicateStart - anchorEnd <= 140) {
      const between = clause.slice(anchorEnd, predicateStart);
      if (/\b(?:competitor|rival|unlike|versus|vs\.?|rather than|not)\b/i.test(between)) continue;
      if (segmentIntroducesNamedActor(between, lead)) continue;
      if (/\b(?:and|while|whereas|but)\s+[A-Z][A-Za-z0-9.'’-]+\s+(?:is|was|has|had|reported|raised|listed|settled|launched|uses|completed|published|deployed|runs)\b/.test(between)) continue;
      return true;
    }
    if (predicateStart < anchorStart && anchorStart - (predicateStart + predicateMatch[0].length) <= 55) {
      const beforeAnchor = clause.slice(predicateStart, anchorStart);
      if (["founded", "product", "exit"].includes(lead.predicate) && !/\b(?:unlike|competitor|rival|not)\b/i.test(beforeAnchor)) return true;
    }
  }
  return false;
}
function legalEntityGovernsClaim(clause, lead) {
  if (!lead.attributedEntity || !looseContainsPhrase(clause, lead.value) || !predicateIsSupported(clause, lead.predicate)) return false;
  const entityPatternText = loosePhrasePattern(lead.attributedEntity);
  const valuePatternText = loosePhrasePattern(lead.value);
  if (!entityPatternText || !valuePatternText) return false;
  const entityPattern3 = new RegExp(`\\b${entityPatternText}\\b`, "i");
  const valuePattern = new RegExp(`\\b${valuePatternText}\\b`, "i");
  const rawEntityMatch = entityPattern3.exec(clause);
  const rawValueMatch = valuePattern.exec(clause);
  if (rawValueMatch?.index !== void 0) {
    const afterValue = clause.slice(rawValueMatch.index + rawValueMatch[0].length);
    const adverseTarget = /\b(?:against|involving)\s+([^,.;]+?)(?=\s+(?:and|but|while|whereas)\b|$)/i.exec(afterValue)?.[1]?.trim();
    if (adverseTarget && !looseContainsPhrase(adverseTarget, lead.attributedEntity)) {
      const targetTokens = sourceTokens(adverseTarget);
      const capitalized = targetTokens.filter((token) => new RegExp("^\\p{Lu}[\\p{L}\\p{M}'\u2019-]+$", "u").test(token.raw));
      const entitySuffix = targetTokens.some((token) => ["company", "corp", "corporation", "exchange", "foundation", "inc", "labs", "llc", "ltd", "protocol"].includes(token.key));
      if (capitalized.length >= 2 || entitySuffix) return false;
    }
  }
  if (rawEntityMatch?.index !== void 0 && /\baccording\s+to\s*$/i.test(clause.slice(Math.max(0, rawEntityMatch.index - 32), rawEntityMatch.index))) return false;
  const predicateAfterEntity = rawEntityMatch?.index !== void 0 && positivePredicateMatches(clause, lead.predicate).some((match) => match.index !== void 0 && match.index >= rawEntityMatch.index);
  if (predicateAfterEntity && !subjectAliasAvoidsTransfer(clause, lead, lead.attributedEntity)) return false;
  const sanitized = clause.replace(/,\s*(?:co[- ]?)?founded\s+by\s+[^,]+,/gi, ", ").replace(/\bthe\s+company\s+(?:co[- ]?)?founded\s+by\s+[^,]+,/gi, "the company ");
  if ([
    new RegExp(`\\b${entityPatternText}(?:['\u2019]s|[- ](?:founded|owned|led))\\s+(?:business|company|firm|project|protocol|venture)?\\s*[A-Z]`, "i"),
    new RegExp(`\\b(?:founded|owned|led)\\s+by\\s+${entityPatternText}\\b`, "i"),
    new RegExp(`\\b${entityPatternText}\\b\\s+(?:and|with)\\s+[A-Z][A-Za-z0-9.'\u2019-]+\\s+(?:settled|was|is|entered|faced|received)\\b`, "i")
  ].some((pattern) => pattern.test(clause))) return false;
  const entityMatch = entityPattern3.exec(sanitized);
  const valueMatch = valuePattern.exec(sanitized);
  if (!entityMatch || entityMatch.index === void 0 || !valueMatch || valueMatch.index === void 0) return false;
  if (entityMatch.index <= valueMatch.index) {
    const between2 = sanitized.slice(entityMatch.index + entityMatch[0].length, valueMatch.index);
    const allowed = /* @__PURE__ */ new Set(["sec", "cftc", "doj", "ftc", "fca", ...looseTokens(lead.value)]);
    const hasOtherNamedActor = sourceTokens(between2).some((token) => new RegExp("^\\p{Lu}[\\p{L}\\p{M}'\u2019-]+$", "u").test(token.raw) && token.raw.length > 1 && !allowed.has(token.key));
    return !hasOtherNamedActor;
  }
  const between = sanitized.slice(valueMatch.index + valueMatch[0].length, entityMatch.index);
  return /\b(?:against|charged|charging|named|sued|suing|with)\b/i.test(between) || /\b(?:charged|indicted|sued)\s*$/i.test(sanitized.slice(Math.max(0, entityMatch.index - 45), entityMatch.index));
}
function legalClaimClause(clauses, lead, aliases) {
  if (!lead.attributedEntity || !lead.eventStatus) return null;
  const directEntity = aliases.some((alias) => exactEntityKey(alias) === exactEntityKey(lead.attributedEntity));
  for (let index = 0; index < clauses.length; index += 1) {
    const clause = clauses[index];
    if (!legalEntityGovernsClaim(clause, lead) || directEntity && !hasSubjectAlias(clause, aliases)) continue;
    if (looseContainsPhrase(clause, lead.eventStatus)) return clause;
    const continuation = clauses[index + 1];
    if (continuation && looseContainsPhrase(continuation, lead.eventStatus) && /\b(?:it|the (?:action|case|matter|proceeding)|this (?:action|case|matter|proceeding))\b/i.test(continuation) && probablePersonSpans(sourceTokens(continuation)).length === 0) return clause;
  }
  return null;
}
function governingClaimClause(passage, lead, aliases, trustedContextTokens) {
  const clauses = attributionClauses(passage);
  if (lead.predicate === "founder") {
    if (!founderAttributionIsSupported(passage, lead, aliases)) return null;
    return clauses.find((clause) => looseContainsPhrase(clause, lead.value) && predicateIsSupported(clause, lead.predicate)) ?? null;
  }
  if (lead.predicate === "legal_regulatory_event") {
    const legalClause = legalClaimClause(clauses, lead, aliases);
    if (!legalClause || !lead.attributedEntity) return null;
    const directEntity = aliases.some((alias) => exactEntityKey(alias) === exactEntityKey(lead.attributedEntity));
    if (directEntity) return legalClause;
    const relationshipBound = clauses.some((clause) => hasSubjectAlias(clause, aliases) && looseContainsPhrase(clause, lead.attributedEntity) && RELATION_LANGUAGE.test(clause));
    return relationshipBound ? legalClause : null;
  }
  if (lead.predicate === "official_identity") {
    const direct2 = directClaimClause(clauses, lead, aliases, trustedContextTokens);
    const personIdentityQuestion = /^(?:person|investor)\.official_identity$/.test(lead.questionId ?? "");
    if (direct2 && (!personIdentityQuestion || titleBindsOfficialIdentity(direct2, lead) || explicitPersonIdentityIsBound(direct2, lead))) return direct2;
    return clauses.find((clause) => hasSubjectAlias(clause, aliases) && looseContainsPhrase(clause, lead.value) && predicateIsSupported(clause, lead.predicate) && (titleBindsOfficialIdentity(clause, lead) || personIdentityQuestion && explicitPersonIdentityIsBound(clause, lead))) ?? null;
  }
  if (DIRECT_RELATION_PREDICATES.has(lead.predicate)) {
    return directClaimClause(clauses, lead, aliases, trustedContextTokens);
  }
  if (!RELATION_CHAIN_PREDICATES.has(lead.predicate)) {
    return directClaimClause(clauses, lead, aliases, trustedContextTokens);
  }
  const anchors = valueAnchorTokens(lead);
  if (!anchors.length) return null;
  const direct = directClaimClause(clauses, lead, aliases, trustedContextTokens);
  if (direct && anchors.some((anchor) => anchorGovernsClaimClause(direct, lead, anchor) || safeHostContextForSentence(direct, trustedContextTokens).has(anchor))) return direct;
  const relationEstablished = clauses.some((clause) => {
    const context = safeHostContextForSentence(clause, trustedContextTokens);
    return hasSubjectAlias(clause, aliases) && RELATION_LANGUAGE.test(clause) && anchors.some((anchor) => looseContainsPhrase(clause, anchor) && !subjectComparisonIsDisqualified(clause, anchor) || context.has(anchor));
  });
  if (!relationEstablished) return null;
  return clauses.find((clause) => anchors.some((anchor) => anchorGovernsClaimClause(clause, lead, anchor))) ?? null;
}
function predicateAttributionIsSupported(passage, lead, aliases, trustedContextTokens) {
  return governingClaimClause(passage, lead, aliases, trustedContextTokens) !== null;
}
function passageSupportsLead(passage, lead, aliases, trustedContextTokens = /* @__PURE__ */ new Set()) {
  const baseSupported = aliases.some((alias) => looseContainsPhrase(passage, alias)) && (looseContainsPhrase(passage, lead.value) || structuredValueIsSupported(passage, lead, trustedContextTokens));
  return baseSupported && predicateAttributionIsSupported(passage, lead, aliases, trustedContextTokens);
}
function overlapScore(left, right) {
  const leftTokens = new Set(looseTokens(left));
  const rightTokens = looseTokens(right);
  return rightTokens.length ? rightTokens.filter((token) => leftTokens.has(token)).length / rightTokens.length : 0;
}
function supportingSourcePassage(page, lead, aliases, trustedContextTokens = /* @__PURE__ */ new Set()) {
  const excerpt = normalize(decodeHtmlEntities(lead.excerpt));
  const exact = page.includes(excerpt) ? excerpt : exactTokenPassage(page, excerpt);
  if (exact && passageSupportsLead(exact, lead, aliases, trustedContextTokens)) return exact;
  const candidates = [.../* @__PURE__ */ new Set([
    ...sourceSentencePassages(page),
    ...sourceAnchorPassages(page, lead.value)
  ])].filter((passage) => passageSupportsLead(passage, lead, aliases, trustedContextTokens));
  if (!candidates.length) return null;
  return candidates.sort((left, right) => overlapScore(right, excerpt) - overlapScore(left, excerpt) || left.length - right.length)[0];
}
var normalizedHost = (host) => host.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
var PATH_TENANTED_HOSTS = /* @__PURE__ */ new Set([
  "bitbucket.org",
  "docs.google.com",
  "drive.google.com",
  "github.com",
  "gitlab.com",
  "linkedin.com",
  "medium.com",
  "notion.so",
  "t.me",
  "x.com",
  "youtube.com"
]);
var CASE_INSENSITIVE_TENANT_PATH_HOSTS = /* @__PURE__ */ new Set(["github.com", "x.com"]);
var sameOfficialDomain = (host, officialHosts) => {
  const candidate = normalizedHost(host);
  return officialHosts.some((official) => {
    const configured = normalizedHost(official);
    return candidate === configured || candidate.endsWith(`.${configured}`);
  });
};
function sameOfficialScope(document, officialScopes) {
  let candidateUrl;
  try {
    candidateUrl = new URL(document.url);
  } catch {
    return false;
  }
  const candidateHost = normalizedHost(document.host);
  return officialScopes.some((scope) => {
    let configured;
    try {
      const configuredUrl = new URL(scope.includes("://") ? scope : `https://${scope}`);
      const path = configuredUrl.pathname.replace(/\/+$/, "");
      configured = {
        host: normalizedHost(configuredUrl.hostname),
        path,
        pathScoped: scope.includes("://") && path.length > 0
      };
    } catch {
      return false;
    }
    const { host: configuredHost, path: configuredPath, pathScoped } = configured;
    const pathTenantedHost = PATH_TENANTED_HOSTS.has(configuredHost);
    if (pathTenantedHost && candidateHost !== configuredHost) return false;
    if (!pathTenantedHost && candidateHost !== configuredHost && !candidateHost.endsWith(`.${configuredHost}`)) return false;
    if (candidateHost !== configuredHost || !pathTenantedHost) return true;
    if (!pathScoped || configuredPath === "/") return false;
    const candidatePath = candidateUrl.pathname.replace(/\/+$/, "");
    const comparableCandidatePath = CASE_INSENSITIVE_TENANT_PATH_HOSTS.has(configuredHost) ? candidatePath.toLowerCase() : candidatePath;
    const comparableConfiguredPath = CASE_INSENSITIVE_TENANT_PATH_HOSTS.has(configuredHost) ? configuredPath.toLowerCase() : configuredPath;
    return comparableCandidatePath === comparableConfiguredPath || comparableCandidatePath.startsWith(`${comparableConfiguredPath}/`);
  });
}
var REGULATORY_HOSTS = [
  "sec.gov",
  "justice.gov",
  "cftc.gov",
  "ftc.gov",
  "finra.org",
  "fca.org.uk",
  "esma.europa.eu"
];
var regulatorySourceSupports = (host, predicate) => ["legal_regulatory_event", "public_security", "legal_entity"].includes(predicate) && sameOfficialDomain(host, REGULATORY_HOSTS);
var exactEntityKey = (value) => looseTokens(value).join(" ");
var attributionScopeFor = (attributedEntity, aliases) => {
  const attributedKey = exactEntityKey(attributedEntity);
  return attributedKey && aliases.some((alias) => exactEntityKey(alias) === attributedKey) ? "direct_subject" : "related_entity";
};
function directPersonLegalIdentityIsBound(passage, aliases, officialCounterpartyHosts) {
  const knownOrganizationTokens = new Set(officialCounterpartyHosts.flatMap((scope) => {
    try {
      const url = new URL(scope.includes("://") ? scope : `https://${scope}`);
      return [...trustedHostContextTokens(url.hostname)];
    } catch {
      return [];
    }
  }));
  if (!knownOrganizationTokens.size) return false;
  return attributionClauses(passage).some((clause) => hasSubjectAlias(clause, aliases) && RELATION_LANGUAGE.test(clause) && [...knownOrganizationTokens].some((token) => looseContainsPhrase(clause, token)));
}
function factId(subjectKey, predicate, value, legalIdentity = "") {
  const normalizedValue = canonicalBasicFactComparisonValue(predicate, searchable(value));
  const identity = `${subjectKey.toLowerCase()}::${predicate}::${normalizedValue}${legalIdentity ? `::${legalIdentity}` : ""}`;
  return `basic_v1_${createHash4("sha256").update(identity).digest("hex")}`;
}
var TOKEN_ENTITY_LEGAL_SUFFIX = "(?:global|group|holding|holdings|co|company|corp|corporation|inc|incorporated|limited|llc|ltd|plc)";
var CAPTURED_TOKEN_ENTITY = "([^,.!?;]{1,100}?)(?=\\s+(?:and|but|that|which|while|who)\\b|[,.;:!?)]|$)";
var CAPTURED_TERMINAL_TOKEN_ENTITY = "([^.!?;]{1,100}?)(?=[.!?;]|$)";
function exactTokenVentureEntityPattern(name) {
  const venture = loosePhrasePattern(name);
  if (!venture) return null;
  return `(?:the\\s+)?${venture}(?:\\s*,?\\s+${TOKEN_ENTITY_LEGAL_SUFFIX})*`;
}
function capturedTokenEntityMatchesVenture(value, relationships) {
  const entity = clean(value, 120);
  return Boolean(entity && relationships.some((relationship) => registryIssuerMatchesRelationship(entity, relationship.name)));
}
function relationshipBoundTokenHasAffirmativeVentureLink(claimClause, lead, relationships) {
  const value = loosePhrasePattern(lead.value);
  if (!value) return false;
  const originAttributions = [...claimClause.matchAll(new RegExp(
    `\\b(?:created|deployed|developed|issued|launched|minted|owned)\\s+(?:by|of)\\s+${CAPTURED_TOKEN_ENTITY}`,
    "gi"
  ))];
  if (originAttributions.some((match) => !capturedTokenEntityMatchesVenture(match[1], relationships))) return false;
  const tokenDescriptor = "(?:official|governance|native|utility|wrapped|erc[- ]?\\d+)";
  const terminalValue = `\\(?${value}\\)?(?=$|\\s*[.!?](?:\\s|$))`;
  const tokenOfVenture = new RegExp(
    `^(?:the\\s+)?\\$?${value}\\s+is\\s+(?:the\\s+)?${tokenDescriptor}\\s+(?:crypto\\s+)?token\\s+of\\s+${CAPTURED_TERMINAL_TOKEN_ENTITY}`,
    "i"
  ).exec(claimClause);
  if (tokenOfVenture && capturedTokenEntityMatchesVenture(tokenOfVenture[1], relationships)) return true;
  const reverseOrigin = new RegExp(
    `^(?:the\\s+)?\\$?${value}\\s+(?:is|was)\\s+(?:created|issued|minted)\\s+by\\s+${CAPTURED_TERMINAL_TOKEN_ENTITY}`,
    "i"
  ).exec(claimClause);
  if (reverseOrigin && capturedTokenEntityMatchesVenture(reverseOrigin[1], relationships)) return true;
  const brandDescriptor = "(?:wrapped|staked|bridged|liquid|tokenized)";
  const brandedBase = `(?:${brandDescriptor}\\s+){1,3}([A-Za-z0-9]{2,12})`;
  const brandedContinuationIsValid = (match) => {
    const base = match?.[1];
    if (!base || !/^[A-Z0-9]{2,12}$/.test(base)) return false;
    const normalizedValue = looseTokens(lead.value).join("");
    if (!normalizedValue.endsWith(base.toLowerCase())) return false;
    const tail = claimClause.slice((match.index ?? 0) + match[0].length).trim();
    if (!tail || /^[\s,.;:!?()[\]'"–—-]+$/.test(tail)) return true;
    const simpleTokenTail = new RegExp(
      `^is\\s+(?:a|an|the)\\s+${tokenDescriptor}\\s+(?:crypto\\s+)?token\\s*[.!?]?$`,
      "i"
    );
    if (simpleTokenTail.test(tail)) return true;
    const stakedRepresentation = new RegExp(
      `^is\\s+a\\s+utility\\s+token\\s+that\\s+represents\\s+([A-Za-z0-9]{2,12})\\s+staked\\s+through\\s+${CAPTURED_TERMINAL_TOKEN_ENTITY}[.!?]?$`,
      "i"
    ).exec(tail);
    if (stakedRepresentation && /^[A-Z0-9]{2,12}$/.test(stakedRepresentation[1]) && stakedRepresentation[1].toLowerCase() === base.toLowerCase() && capturedTokenEntityMatchesVenture(stakedRepresentation[2], relationships)) return true;
    const backedRepresentation = new RegExp(
      `^[,;:\\u2013\\u2014-]?\\s*an\\s+erc(?:[- ]?\\d+)?\\s+token\\s+backed\\s+1:1\\s+by\\s+(Bitcoin|BTC)\\s+held\\s+by\\s+${CAPTURED_TERMINAL_TOKEN_ENTITY}[.!?]?$`,
      "i"
    ).exec(tail);
    return Boolean(
      backedRepresentation && base.toUpperCase() === "BTC" && capturedTokenEntityMatchesVenture(backedRepresentation[2], relationships)
    );
  };
  return relationships.some((relationship) => {
    const venture = exactTokenVentureEntityPattern(relationship.name);
    if (!venture) return false;
    const directOrigin = new RegExp(
      `^${venture}\\s+(?:created|issued|minted)\\s+${terminalValue}`,
      "i"
    ).test(claimClause);
    if (directOrigin) return true;
    const possessive = new RegExp(
      `^${venture}['\u2019]s\\s+(?:${tokenDescriptor}\\s+){1,2}(?:crypto\\s+)?token\\s+(?:is\\s+)?${terminalValue}`,
      "i"
    ).test(claimClause);
    if (possessive) return true;
    const directBrand = new RegExp(
      `^${venture}\\s+${brandedBase}\\s*\\(\\s*${value}\\s*\\)`,
      "i"
    ).exec(claimClause);
    if (brandedContinuationIsValid(directBrand)) return true;
    const combinedBrand = new RegExp(
      `^${venture}\\s+is\\s+rolling\\s+out\\s+${value}\\s*[,;:\\u2013\\u2014-]\\s*${venture}\\s+${brandedBase}`,
      "i"
    ).exec(claimClause);
    if (brandedContinuationIsValid(combinedBrand)) return true;
    const valueFirstBrand = new RegExp(
      `^(?:the\\s+)?\\$?${value}\\s*[,;:\\u2013\\u2014-]\\s*${venture}\\s+${brandedBase}`,
      "i"
    ).exec(claimClause);
    return brandedContinuationIsValid(valueFirstBrand);
  });
}
var TOKEN_PAGE_UNCERTAINTY = /\b(?:alleged|candidate|claimed|demo|draft|experimental|fake|former|future|hypothetical|intended|mock|non-live|potential|proposed|purported|rumored|so-called|supposedly|test|testnet|unofficial|unlaunched|uncertain)\b/i;
function coinbaseWrappedAssetLocaleFallback(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    if (url.hostname !== "www.coinbase.com" && url.hostname !== "coinbase.com") return null;
    if (url.search || url.hash) return null;
    const match = /^\/(cbbtc|cbeth)\/?$/i.exec(url.pathname);
    if (!match) return null;
    url.pathname = `/en-mx/${match[1].toLowerCase()}`;
    return url.toString();
  } catch {
    return null;
  }
}
function coinbaseWrappedAssetProductPassage(title, body, symbol) {
  if (!looseContainsPhrase(title, "Coinbase") || !looseContainsPhrase(title, symbol) || /\b(?:404|not found|page unavailable)\b/i.test(title)) return null;
  const normalizedBody = normalize(decodeHtmlEntities(body.replace(/<[^>]+>/g, " ")));
  if (searchable(symbol) === "cbbtc") {
    const wrappedCustody = /\bCoinbase\s+wrapped\s+assets?\b[^.!?]{0,220}\bbacked\s+1:1\b[^.!?]{0,160}\bheld\s+in\s+custody\s+by\s+Coinbase\b/i.exec(normalizedBody);
    return wrappedCustody ? normalize(`${title}. ${wrappedCustody[0]}`) : null;
  }
  if (searchable(symbol) === "cbeth") {
    const productClass = /(?:\bliquid\s+staking\s+token\b|\bwrap\s+your\s+staked\s+ETH\s+to\s+cbETH\b|\bcbETH\b[^.!?]{0,120}\btraded\s+on\s+Coinbase\b)/i.exec(normalizedBody);
    const ventureWhitepaper = /(?:\bCoinbase['’]s\s+whitepaper\b[^.!?]{0,260}\bcbETH\b|\bcbETH\b[^.!?]{0,260}\bCoinbase['’]s\s+whitepaper\b)/i.exec(normalizedBody);
    return productClass && ventureWhitepaper ? normalize(`${title}. ${productClass[0]}. ${ventureWhitepaper[0]}`) : null;
  }
  return null;
}
function isExpectedCoinbaseWrappedAssetPage(result, fallbackUrl) {
  if (result.status !== "ok") return false;
  const symbol = new URL(fallbackUrl).pathname.split("/").filter(Boolean).at(-1) ?? "";
  let pathSegments;
  try {
    pathSegments = decodeURIComponent(new URL(result.url).pathname).split("/").filter(Boolean);
  } catch {
    return false;
  }
  const exactProductPath = pathSegments.length === 1 || pathSegments.length === 2 && /^[a-z]{2}(?:-[a-z]{2})?$/i.test(pathSegments[0]);
  if (!exactProductPath || searchable(pathSegments.at(-1) ?? "") !== searchable(symbol)) return false;
  const metadata = /^Title:\s*(.+?)\s+URL Source:\s*(.+?)\s+Markdown Content:\s*/i.exec(result.text);
  const htmlTitle = /<title\b[^>]*>([\s\S]{1,1000}?)<\/title>/i.exec(result.text)?.[1];
  const title = normalize(decodeHtmlEntities((metadata?.[1] ?? htmlTitle ?? "").replace(/<[^>]+>/g, " ")));
  const body = metadata?.[1] && metadata.index === 0 ? result.text.slice(metadata[0].length) : result.text;
  return Boolean(coinbaseWrappedAssetProductPassage(title, body, symbol));
}
function officialVentureAssetPagePassage(document, page, lead, relationships) {
  if (!/^\$?[A-Za-z][A-Za-z0-9.-]{1,15}$/.test(lead.value)) return null;
  const metadata = /^Title:\s*(.+?)\s+URL Source:\s*(.+?)\s+Markdown Content:\s*/i.exec(page);
  const htmlTitle = /html|xhtml/i.test(document.contentType) ? /<title\b[^>]*>([\s\S]{1,1000}?)<\/title>/i.exec(document.text)?.[1] : void 0;
  if ((!metadata?.[1] || metadata.index !== 0) && !htmlTitle) return null;
  const title = normalize(decodeHtmlEntities((metadata?.[1] ?? htmlTitle ?? "").replace(/<[^>]+>/g, " ")));
  const body = metadata?.[1] && metadata.index === 0 ? page.slice(metadata[0].length) : page;
  let pathSymbol;
  try {
    const segments = decodeURIComponent(new URL(document.url).pathname).split("/").filter(Boolean);
    if (segments.length === 2 && !/^[a-z]{2}(?:-[a-z]{2})?$/i.test(segments[0])) return null;
    if (segments.length !== 1 && segments.length !== 2) return null;
    pathSymbol = searchable(segments.at(-1) ?? "");
  } catch {
    return null;
  }
  if (pathSymbol !== searchable(lead.value)) return null;
  for (const relationship of relationships) {
    if (!looseContainsPhrase(title, relationship.name) || !looseContainsPhrase(title, lead.value)) continue;
    const venture = loosePhrasePattern(relationship.name);
    const value = loosePhrasePattern(lead.value);
    if (!venture || !value) continue;
    if (searchable(relationship.name) === "coinbase") {
      const verifiedCoinbaseProduct = coinbaseWrappedAssetProductPassage(title, body, lead.value);
      if (verifiedCoinbaseProduct && verifiedCoinbaseProduct.length <= MAX_SUPPORT_PASSAGE_CHARS && !TOKEN_PAGE_UNCERTAINTY.test(verifiedCoinbaseProduct)) return verifiedCoinbaseProduct;
    }
    const wrappedCustody = new RegExp(
      `\\b${venture}\\s+wrapped\\s+assets?\\b[^.!?]{0,220}\\bbacked\\s+1:1\\b[^.!?]{0,160}\\bheld\\s+in\\s+custody\\s+by\\s+${venture}\\b`,
      "i"
    ).exec(body);
    if (wrappedCustody) {
      const passage2 = normalize(`${title}. ${wrappedCustody[0]}`);
      if (passage2.length <= MAX_SUPPORT_PASSAGE_CHARS && !TOKEN_PAGE_UNCERTAINTY.test(passage2)) return passage2;
    }
    const tokenClass = new RegExp(
      `\\b\\$?${value}\\b[^.!?]{0,140}\\b(?:(?:liquid\\s+staking|wrapped|staked|governance|native|utility|erc[- ]?\\d+)\\s+)?token\\b`,
      "i"
    ).exec(body);
    const wrappedStakingProduct = new RegExp(
      `(?:\\bwrap\\s+your\\s+staked\\s+[a-z0-9-]+\\s+to\\s+\\$?${value}\\b|\\b\\$?${value}\\b[^.!?]{0,120}\\btraded\\s+on\\s+${venture}\\b)`,
      "i"
    ).exec(body);
    const ventureWhitepaper = new RegExp(
      `(?:\\b${venture}['\u2019]s\\s+whitepaper\\b[^.!?]{0,260}\\b\\$?${value}\\b|\\b\\$?${value}\\b[^.!?]{0,260}\\b${venture}['\u2019]s\\s+whitepaper\\b)`,
      "i"
    ).exec(body);
    const productClass = tokenClass ?? wrappedStakingProduct;
    if (!productClass || !ventureWhitepaper) continue;
    const passage = normalize(`${title}. ${productClass[0]}. ${ventureWhitepaper[0]}`);
    if (passage.length <= MAX_SUPPORT_PASSAGE_CHARS && looseContainsPhrase(passage, relationship.name) && looseContainsPhrase(passage, lead.value) && !TOKEN_PAGE_UNCERTAINTY.test(passage)) return passage;
  }
  return null;
}
function verifyBasicFactLead(lead, document, aliases, subjectKey = lead.subject, officialHosts = [], officialCounterpartyHosts = [], ventureAssetRelationships = []) {
  const page = documentText(document);
  if (!isAtomicValue(lead.predicate, lead.value)) return null;
  if (lead.predicate === "legal_regulatory_event" && (!lead.eventStatus || !lead.attributedEntity)) return null;
  const official = sameOfficialScope(document, officialHosts);
  const publicSecurityRegulator = lead.predicate === "public_security" && regulatorySourceSupports(document.host, lead.predicate);
  const ventureAssetPredicate = lead.predicate === "public_security" || lead.predicate === "official_token";
  const authoritativeAssetRelationships = ventureAssetPredicate ? ventureAssetRelationships.filter((relationship) => {
    const ventureNamedByLead = looseContainsPhrase(
      `${lead.value} ${lead.qualifier ?? ""} ${lead.excerpt} ${lead.sourceTitle ?? ""}`,
      relationship.name
    );
    const ventureOfficial = relationship.officialScopes.some((scope) => sameOfficialScope(document, [scope]));
    return ventureNamedByLead && (ventureOfficial || publicSecurityRegulator);
  }) : [];
  const verificationAliases = [
    ...aliases,
    ...authoritativeAssetRelationships.map((relationship) => relationship.name)
  ];
  const counterpartyPredicate = (/* @__PURE__ */ new Set([
    "official_identity",
    "current_role",
    "prior_role",
    "founder",
    "executive",
    "founded",
    "product",
    "exit",
    "track_record",
    "funding",
    "investor",
    "legal_entity",
    "governance",
    "public_security",
    "official_token"
  ])).has(lead.predicate);
  const applicableCounterpartyHosts = ventureAssetPredicate ? authoritativeAssetRelationships.flatMap((relationship) => relationship.officialScopes) : officialCounterpartyHosts;
  const officialCounterparty = !official && counterpartyPredicate && sameOfficialScope(document, applicableCounterpartyHosts);
  const contextTokens = official || officialCounterparty ? trustedHostContextTokens(document.host) : /* @__PURE__ */ new Set();
  const personOrInvestorAsset = /^(?:person|investor)\./.test(lead.questionId ?? "");
  const officialAssetPageEvidence = lead.predicate === "official_token" && personOrInvestorAsset && officialCounterparty && authoritativeAssetRelationships.length ? officialVentureAssetPagePassage(document, page, lead, authoritativeAssetRelationships) : null;
  const excerpt = officialAssetPageEvidence ?? supportingSourcePassage(page, lead, verificationAliases, contextTokens);
  if (!excerpt) return null;
  const claimClause = officialAssetPageEvidence ?? governingClaimClause(excerpt, lead, verificationAliases, contextTokens);
  if (!claimClause) return null;
  if (lead.predicate === "official_token" && authoritativeAssetRelationships.length) {
    const explicitTokenLanguage = Boolean(officialAssetPageEvidence) || EXPLICIT_OFFICIAL_CRYPTO_TOKEN.test(claimClause) || EXPLICIT_WRAPPED_OR_ERC_TOKEN.test(claimClause);
    const affirmativeVentureLink = relationshipBoundTokenHasAffirmativeVentureLink(
      claimClause,
      lead,
      authoritativeAssetRelationships
    ) || Boolean(officialAssetPageEvidence);
    if (personOrInvestorAsset && (!explicitTokenLanguage || !affirmativeVentureLink)) return null;
    if (!personOrInvestorAsset && !EXPLICIT_OFFICIAL_CRYPTO_TOKEN.test(claimClause) && !affirmativeVentureLink) return null;
  }
  const verifiedValue = lead.predicate === "public_security" ? verifiedPublicSecurityValue(lead.value, claimClause) : lead.value;
  if (!verifiedValue) return null;
  const regulatory = !official && !officialCounterparty && regulatorySourceSupports(document.host, lead.predicate);
  const supportedQualifier = lead.qualifier && looseContainsPhrase(claimClause, lead.qualifier) ? lead.qualifier : void 0;
  const supportedEventStatus = lead.eventStatus && looseContainsPhrase(excerpt, lead.eventStatus) ? lead.eventStatus : void 0;
  const supportedAttributedEntity = lead.attributedEntity && looseContainsPhrase(excerpt, lead.attributedEntity) ? lead.attributedEntity : void 0;
  if (lead.predicate === "legal_regulatory_event" && (!supportedEventStatus || !supportedAttributedEntity)) return null;
  const rawAttributionScope = supportedAttributedEntity ? attributionScopeFor(supportedAttributedEntity, aliases) : void 0;
  const personOrInvestorLegalQuestion = lead.predicate === "legal_regulatory_event" && /^(?:person|investor)\./.test(lead.questionId ?? "");
  const attributionScope = rawAttributionScope === "direct_subject" && personOrInvestorLegalQuestion && !official && !officialCounterparty && !directPersonLegalIdentityIsBound(excerpt, aliases, officialCounterpartyHosts) ? "identity_unresolved" : rawAttributionScope;
  const legalIdentity = lead.predicate === "legal_regulatory_event" ? `${searchable(supportedAttributedEntity)}::${searchable(supportedEventStatus)}` : "";
  const retrievalProvider = "retrievalProvider" in document && document.retrievalProvider === "jina-reader" ? "jina-reader" : "public-web";
  return {
    factId: factId(subjectKey, lead.predicate, verifiedValue, legalIdentity),
    subjectKey,
    predicate: lead.predicate,
    value: verifiedValue,
    normalizedValue: canonicalBasicFactComparisonValue(lead.predicate, searchable(verifiedValue)),
    status: official || officialCounterparty || regulatory ? "verified" : "lead",
    critical: CRITICAL_PREDICATES.has(lead.predicate),
    sources: [{
      url: document.url,
      ...lead.sourceTitle ? { title: lead.sourceTitle } : {},
      sourceClass: official ? "official_subject" : officialCounterparty ? "official_counterparty" : regulatory ? "regulatory_or_onchain" : "independent_press",
      relation: "supports",
      excerpt,
      contentHash: document.contentHash,
      capturedAt: document.capturedAt,
      provider: retrievalProvider,
      artifactVerified: true
    }],
    ...supportedQualifier ? { qualifier: supportedQualifier } : {},
    ...lead.questionId ? { questionId: lead.questionId } : {},
    ...supportedEventStatus ? { eventStatus: supportedEventStatus } : {},
    ...supportedAttributedEntity ? { attributedEntity: supportedAttributedEntity } : {},
    ...attributionScope ? { attributionScope } : {},
    evidence_origin: "deterministic",
    artifact_verified: true,
    provider: "public-web",
    discoveryProvider: lead.provider
  };
}
var MULTI_VALUE_PREDICATES = /* @__PURE__ */ new Set([
  "current_role",
  "prior_role",
  "education",
  "founder",
  "executive",
  "founded",
  "launched",
  "exit",
  "track_record",
  "product",
  "funding",
  "investor",
  "governance",
  "public_security",
  "legal_entity",
  "legal_regulatory_event",
  "control",
  "conflict_of_interest",
  "tokenomics",
  "vesting",
  "treasury",
  "audit",
  "repository",
  "traction"
]);
function resolveBasicFactCandidates(candidates) {
  const grouped = /* @__PURE__ */ new Map();
  for (const candidate of candidates) {
    const legalIdentity = candidate.predicate === "legal_regulatory_event" ? `::${searchable(candidate.attributedEntity ?? "")}::${searchable(candidate.eventStatus ?? "")}` : "";
    const key = `${candidate.predicate}::${candidate.normalizedValue}${legalIdentity}`;
    const rows = grouped.get(key) ?? [];
    rows.push(candidate);
    grouped.set(key, rows);
  }
  const resolved = [...grouped.values()].flatMap((rows) => {
    const sources = [...new Map(rows.flatMap((row) => row.sources).map((source2) => [source2.url, source2])).values()];
    const official = sources.some((source2) => source2.sourceClass === "official_subject" || source2.sourceClass === "official_counterparty" || source2.sourceClass === "regulatory_or_onchain");
    const independentHosts = new Set(sources.filter((source2) => source2.sourceClass === "independent_press").map((source2) => new URL(source2.url).hostname.replace(/^www\./, "")));
    if (rows[0]?.predicate === "public_security" && !official) return [];
    if (!official && independentHosts.size < 2) return [];
    return [{
      ...rows[0],
      status: official ? "verified" : "corroborated",
      sources
    }];
  });
  const singletonPredicates = new Set(resolved.filter((fact) => !MULTI_VALUE_PREDICATES.has(fact.predicate) && !(fact.predicate === "official_token" && /^(?:person|investor)\./.test(fact.questionId ?? ""))).map((fact) => fact.predicate));
  for (const predicate of singletonPredicates) {
    const values = resolved.filter((fact) => fact.predicate === predicate && !(fact.predicate === "official_token" && /^(?:person|investor)\./.test(fact.questionId ?? "")));
    if (values.length > 1) values.forEach((fact) => {
      fact.status = "conflicted";
    });
  }
  const legalEvents = /* @__PURE__ */ new Map();
  for (const fact of resolved.filter((candidate) => candidate.predicate === "legal_regulatory_event")) {
    const key = `${fact.normalizedValue}::${searchable(fact.attributedEntity ?? "")}`;
    legalEvents.set(key, [...legalEvents.get(key) ?? [], fact]);
  }
  for (const rows of legalEvents.values()) {
    const statuses = new Set(rows.map((fact) => searchable(fact.eventStatus ?? "")).filter(Boolean));
    if (statuses.size > 1) rows.forEach((fact) => {
      fact.status = "conflicted";
    });
  }
  return resolved;
}
var personKey = (value) => looseTokens(value).join(" ");
function teamSourceCandidates(ctx, lead) {
  if (lead.predicate !== "founder" && lead.predicate !== "executive") return [];
  return (ctx.evidence.webTeam ?? []).flatMap((member) => {
    if (member.artifact_verified !== true || member.evidence_origin !== "deterministic" || personKey(member.name) !== personKey(lead.value) || lead.predicate === "founder" && !/\bfounder\b|\bco[- ]?founder\b/i.test(member.role) || lead.predicate === "executive" && !PREDICATE_PATTERNS.executive.test(member.role)) return [];
    const url = safeCandidateUrl(member.sourceUrl);
    if (!url) return [];
    const title = clean(member.source, 240);
    return [{ url, ...title ? { title } : {} }];
  });
}
function verificationLeadVariants(ctx, leads, officialHosts, officialCounterpartyHosts = []) {
  const variants = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (lead, value, title, primary) => {
    const sourceUrl = safeCandidateUrl(value);
    if (!sourceUrl) return;
    const key = `${lead.predicate}::${personKey(lead.value)}::${sourceUrl}`;
    if (seen.has(key)) return;
    seen.add(key);
    let official = false;
    try {
      const host = new URL(sourceUrl).hostname;
      official = sameOfficialScope({ host, url: sourceUrl }, officialHosts) || sameOfficialScope({ host, url: sourceUrl }, officialCounterpartyHosts);
    } catch {
    }
    const variantLead = { ...lead, sourceUrl };
    if (title) variantLead.sourceTitle = title;
    else delete variantLead.sourceTitle;
    variants.push({
      lead: variantLead,
      priority: official ? 0 : primary ? 1 : 2
    });
  };
  for (const lead of leads) {
    add(lead, lead.sourceUrl, lead.sourceTitle, true);
    for (const sourceUrl of lead.candidateUrls ?? []) add(lead, sourceUrl, void 0, false);
    for (const source2 of teamSourceCandidates(ctx, lead)) add(lead, source2.url, source2.title, false);
  }
  return variants.sort((left, right) => left.priority - right.priority);
}
function normalizeDiscoveryOutput(output) {
  if (output && !Array.isArray(output)) return { ...output, leads: selectBasicFactLeads(output.leads) };
  if (output === null) {
    return { provider: "test", state: "failed", leads: [], attempts: 1, completedBatches: 0, failedBatches: 1 };
  }
  const leads = selectBasicFactLeads(output);
  return {
    provider: "test",
    state: leads.length ? "succeeded" : "completed_empty",
    leads,
    attempts: 1,
    completedBatches: 1,
    failedBatches: 0
  };
}
function mergeLeads(primary, repair) {
  const seen = /* @__PURE__ */ new Set();
  const merged = [...repair, ...primary].filter((lead) => {
    const key = `${lead.predicate}::${searchable(lead.value)}::${lead.sourceUrl}::${searchable(lead.excerpt)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return selectBasicFactLeads(merged);
}
var SEC_EXCHANGE_REGISTRY_URL = "https://www.sec.gov/files/company_tickers_exchange.json";
async function fetchSecExchangeRegistry() {
  let response;
  try {
    response = await fetch(SEC_EXCHANGE_REGISTRY_URL, {
      headers: {
        accept: "application/json",
        // SEC.gov's fair-access policy rejects requests without a
        // self-identifying User-Agent (403). Same identity publicWeb uses.
        "user-agent": "ARGUS/3.0 (+https://argus-one-flax.vercel.app; due-diligence evidence research)"
      },
      signal: AbortSignal.timeout(15e3)
    });
  } catch {
    return { status: "failed", reason: "transport_error" };
  }
  if (!response.ok) return { status: "failed", reason: `http_${response.status}` };
  let text2;
  try {
    text2 = await response.text();
  } catch {
    return { status: "failed", reason: "response_text_error" };
  }
  return {
    status: "ok",
    url: SEC_EXCHANGE_REGISTRY_URL,
    host: "www.sec.gov",
    contentType: response.headers.get("content-type") ?? "application/json",
    text: text2,
    contentHash: createHash4("sha256").update(text2).digest("hex"),
    capturedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
async function screenSecRegistryForNames(names) {
  const screenable = [...new Set(names.map((name) => name.trim()).filter((name) => name.length > 1))];
  if (!screenable.length) return null;
  const registry = await fetchSecExchangeRegistry();
  if (registry.status !== "ok") return null;
  const rows = secExchangeRegistryRows(registry);
  if (rows === null) return null;
  return screenable.some((name) => rows.some((row) => registryIssuerMatchesRelationship(row.name, name))) ? "matched" : "empty";
}
var CURRENT_CONTROL_ROLE = /\b(?:co[- ]?founder|founder|chief executive officer|ceo|chair(?:man|woman|person)?|owner|controlling)\b/i;
var CURRENT_PERIOD = /\b(?:current|currently|now|ongoing|present|today)\b/i;
var VENTURE_IDENTITY_STOP_WORDS = /* @__PURE__ */ new Set([
  "co",
  "company",
  "corp",
  "corporation",
  "dao",
  "exchange",
  "foundation",
  "global",
  "group",
  "holding",
  "holdings",
  "inc",
  "labs",
  "limited",
  "llc",
  "ltd",
  "network",
  "plc",
  "project",
  "protocol",
  "technologies",
  "technology",
  "the"
]);
var COMMON_COUNTRY_PUBLIC_SUFFIX_LABELS = /* @__PURE__ */ new Set([
  "ac",
  "co",
  "com",
  "edu",
  "gov",
  "net",
  "org"
]);
var REGISTRY_LEGAL_ENTITY_TOKENS = /* @__PURE__ */ new Set([
  "co",
  "company",
  "corp",
  "corporation",
  "inc",
  "incorporated",
  "limited",
  "llc",
  "ltd",
  "plc",
  "the"
]);
var REGISTRY_SHORTHAND_QUALIFIERS = /* @__PURE__ */ new Set([
  "global",
  "group",
  "holding",
  "holdings"
]);
function safeVentureScope(value) {
  if (!value?.trim()) return null;
  return safeCandidateUrl(value.includes("://") ? value : `https://${value}`);
}
function ventureIdentityTokens(venture) {
  return [...new Set([
    ...looseTokens(venture.project_name),
    ...looseTokens(venture.x_handle?.replace(/^@/, "") ?? "")
  ].filter((token) => token.length >= 4 && !VENTURE_IDENTITY_STOP_WORDS.has(token)))];
}
function evidenceUrlMatchesVentureIdentity(scope, venture) {
  let url;
  try {
    url = new URL(scope);
  } catch {
    return false;
  }
  const host = normalizedHost(url.hostname);
  const identityTokens = ventureIdentityTokens(venture);
  if (!identityTokens.length) return false;
  if (PATH_TENANTED_HOSTS.has(host)) {
    let decodedPath;
    try {
      decodedPath = decodeURIComponent(url.pathname);
    } catch {
      return false;
    }
    const pathTokens = looseTokens(decodedPath);
    return identityTokens.some((token) => pathTokens.includes(token));
  }
  const hostLabels = host.split(".").map((label) => label.replace(/[^a-z0-9]/g, ""));
  return identityTokens.some((token) => hostLabels.includes(token));
}
function verifiedVentureOfficialScopes(venture) {
  const domainScope = safeVentureScope(venture.domain);
  const evidenceScope = safeVentureScope(venture.evidence_url);
  return [.../* @__PURE__ */ new Set([
    ...domainScope ? [domainScope] : [],
    ...evidenceScope && evidenceUrlMatchesVentureIdentity(evidenceScope, venture) ? [evidenceScope] : []
  ])];
}
function verifiedVentureAssetRelationships(ctx) {
  return ctx.evidence.ventures.flatMap((venture) => {
    if (venture.artifact_verified !== true || venture.evidence_origin === "model_lead" || !venture.project_name?.trim() || !CURRENT_CONTROL_ROLE.test(venture.role ?? "") || !CURRENT_PERIOD.test(venture.period ?? "")) return [];
    const officialScopes = verifiedVentureOfficialScopes(venture);
    return officialScopes.length ? [{ name: venture.project_name.trim(), officialScopes }] : [];
  });
}
function currentRoleRelationshipParts(value) {
  const direct = /^(.{2,160}?)\s+(?:at|of)\s+(.{2,160})$/i.exec(normalize(value));
  const comma = direct ? null : /^(.{2,160}?),\s+(.{2,160})$/.exec(normalize(value));
  const role = clean(direct?.[1] ?? comma?.[1], 160);
  const name = clean(direct?.[2] ?? comma?.[2], 160);
  return role && name && CURRENT_CONTROL_ROLE.test(role) ? { role, name } : null;
}
function sourceBackedFounderRelationshipLeads(ctx, facts) {
  const audience = researchAudience(ctx);
  if (audience === "project") return [];
  const identities = facts.filter((fact) => fact.predicate === "official_identity" && fact.artifact_verified === true && (fact.status === "verified" || fact.status === "corroborated") && plausiblePersonIdentity(fact.value));
  const relationships = facts.flatMap((fact) => {
    if (fact.predicate !== "current_role" || fact.artifact_verified !== true || fact.status !== "verified") return [];
    const relationship = currentRoleRelationshipParts(fact.value);
    const name = relationship ? atomicPersonVentureValue(relationship.name) : null;
    return name ? [{ name, discoveryProvider: fact.discoveryProvider }] : [];
  });
  if (!identities.length || !relationships.length) return [];
  const aliases = [.../* @__PURE__ */ new Set([...subjectAliases(ctx), ...identities.map((identity) => identity.value)])];
  const seen = /* @__PURE__ */ new Set();
  return identities.flatMap((identity) => relationships.flatMap((relationship) => facts.flatMap((fact) => fact.sources.flatMap((source2) => {
    if (source2.artifactVerified !== true || source2.sourceClass !== "official_subject" && source2.sourceClass !== "official_counterparty" || !looseContainsPhrase(source2.excerpt, identity.value) || !looseContainsPhrase(source2.excerpt, relationship.name) || !predicateIsSupported(source2.excerpt, "founder")) return [];
    const lead = {
      subject: identity.value,
      predicate: "founder",
      value: relationship.name,
      questionId: `${audience}.founder`,
      excerpt: source2.excerpt,
      sourceUrl: source2.url,
      ...source2.title ? { sourceTitle: source2.title } : {},
      evidence_origin: "model_lead",
      artifact_verified: false,
      provider: identity.discoveryProvider ?? relationship.discoveryProvider ?? "claude-web-search"
    };
    if (!founderAttributionIsSupported(source2.excerpt, lead, aliases)) return [];
    const key = `${searchable(relationship.name)}::${source2.url}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [lead];
  }))));
}
function scopeMatchesOrganizationIdentity(scope, name) {
  let url;
  try {
    url = new URL(scope);
  } catch {
    return false;
  }
  const identityTokens = looseTokens(name).filter((token) => token.length >= 4 && !VENTURE_IDENTITY_STOP_WORDS.has(token));
  if (!identityTokens.length) return false;
  const host = normalizedHost(url.hostname);
  if (PATH_TENANTED_HOSTS.has(host)) {
    let decodedPath;
    try {
      decodedPath = decodeURIComponent(url.pathname);
    } catch {
      return false;
    }
    const pathTokens = looseTokens(decodedPath);
    return identityTokens.some((token) => pathTokens.includes(token));
  }
  const hostLabels = host.split(".").map((label) => label.replace(/[^a-z0-9]/g, ""));
  const lastLabel = hostLabels.at(-1) ?? "";
  const penultimateLabel = hostLabels.at(-2) ?? "";
  const suffixWidth = hostLabels.length >= 3 && lastLabel.length === 2 && COMMON_COUNTRY_PUBLIC_SUFFIX_LABELS.has(penultimateLabel) ? 2 : 1;
  const organizationLabel = hostLabels.at(-(suffixWidth + 1));
  return Boolean(organizationLabel && identityTokens.includes(organizationLabel));
}
function verifiedOrganizationScope(scope, name) {
  if (!scopeMatchesOrganizationIdentity(scope, name)) return null;
  let url;
  try {
    url = new URL(scope);
  } catch {
    return null;
  }
  const host = normalizedHost(url.hostname);
  if (PATH_TENANTED_HOSTS.has(host)) return safeVentureScope(scope);
  const hostLabels = host.split(".");
  const lastLabel = hostLabels.at(-1) ?? "";
  const penultimateLabel = hostLabels.at(-2) ?? "";
  const suffixWidth = hostLabels.length >= 3 && lastLabel.length === 2 && COMMON_COUNTRY_PUBLIC_SUFFIX_LABELS.has(penultimateLabel) ? 2 : 1;
  const registrableHost = hostLabels.slice(-(suffixWidth + 1)).join(".");
  if (!registrableHost.includes(".")) return null;
  return `${url.protocol}//${registrableHost}/`;
}
function verifiedFactAssetRelationships(ctx, facts) {
  const aliases = subjectAliases(ctx);
  return facts.flatMap((fact) => {
    if (fact.predicate !== "current_role" || fact.artifact_verified !== true || fact.status !== "verified" && fact.status !== "corroborated") return [];
    const relationship = currentRoleRelationshipParts(fact.value);
    if (!relationship) return [];
    const scopes = fact.sources.flatMap((source2) => {
      if (source2.artifactVerified !== true || source2.relation !== "supports" || source2.sourceClass !== "official_subject" && source2.sourceClass !== "official_counterparty" || !hasSubjectAlias(source2.excerpt, aliases) || !CURRENT_CONTROL_ROLE.test(source2.excerpt) || !PREDICATE_PATTERNS.current_role.test(source2.excerpt)) return [];
      const scope = verifiedOrganizationScope(source2.url, relationship.name);
      return scope ? [scope] : [];
    });
    return scopes.length ? [{ name: relationship.name, officialScopes: [...new Set(scopes)] }] : [];
  });
}
function mergeVentureAssetRelationships(relationships) {
  const merged = /* @__PURE__ */ new Map();
  for (const relationship of relationships) {
    const key = ventureRegistryIdentity(relationship.name);
    if (!key) continue;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { name: relationship.name, officialScopes: [...new Set(relationship.officialScopes)] });
      continue;
    }
    existing.officialScopes = [.../* @__PURE__ */ new Set([...existing.officialScopes, ...relationship.officialScopes])];
  }
  return [...merged.values()];
}
function secExchangeRegistryRows(document) {
  let jsonText = document.text;
  if ("retrievalProvider" in document && document.retrievalProvider === "jina-reader") {
    const markers = [...document.text.matchAll(/^Markdown Content:\s*$/gm)];
    if (markers.length !== 1 || markers[0].index === void 0) return null;
    jsonText = document.text.slice(markers[0].index + markers[0][0].length).trim();
  }
  let payload;
  try {
    payload = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const fields = payload.fields;
  const data = payload.data;
  if (!Array.isArray(fields) || !Array.isArray(data)) return null;
  const indexes = new Map(fields.map((field, index) => [String(field).trim().toLowerCase(), index]));
  const cikIndex = indexes.get("cik");
  const nameIndex = indexes.get("name");
  const tickerIndex = indexes.get("ticker");
  const exchangeIndex = indexes.get("exchange");
  if ([cikIndex, nameIndex, tickerIndex, exchangeIndex].some((index) => index === void 0)) return null;
  return data.flatMap((raw) => {
    if (!Array.isArray(raw)) return [];
    const cik = Number(raw[cikIndex]);
    const name = clean(raw[nameIndex], 240);
    const ticker = clean(raw[tickerIndex], 24)?.toUpperCase();
    const exchange = clean(raw[exchangeIndex], 80);
    if (!Number.isSafeInteger(cik) || cik <= 0 || !name || !ticker || !exchange || !/^[A-Z0-9][A-Z0-9.-]{0,23}$/.test(ticker)) return [];
    return [{ cik, name, ticker, exchange, raw }];
  });
}
function ventureRegistryIdentity(value) {
  return looseTokens(value).filter((token) => token.length >= 2 && !REGISTRY_LEGAL_ENTITY_TOKENS.has(token)).join(" ");
}
function registryIssuerMatchesRelationship(issuerName, relationshipName) {
  const issuerTokens = ventureRegistryIdentity(issuerName).split(" ").filter(Boolean);
  const relationshipTokens = ventureRegistryIdentity(relationshipName).split(" ").filter(Boolean);
  if (!issuerTokens.length || !relationshipTokens.length) return false;
  if (issuerTokens.length === relationshipTokens.length) {
    return issuerTokens.every((token, index) => token === relationshipTokens[index]);
  }
  return issuerTokens.length > relationshipTokens.length && relationshipTokens.every((token, index) => token === issuerTokens[index]) && issuerTokens.slice(relationshipTokens.length).every((token) => REGISTRY_SHORTHAND_QUALIFIERS.has(token));
}
function exactSecRegistryExcerpt(document, raw) {
  const serialized = JSON.stringify(raw);
  const exactIndex = document.text.indexOf(serialized);
  if (exactIndex >= 0) return document.text.slice(exactIndex, exactIndex + serialized.length);
  const values = raw.map((value) => escapedPattern(String(value)));
  const pattern = new RegExp(`\\[\\s*${values.join("\\s*,\\s*")}\\s*\\]`);
  return document.text.match(pattern)?.[0] ?? null;
}
function secRegistryPublicSecurityFacts(ctx, document, relationships, questionId) {
  const rows = secExchangeRegistryRows(document);
  if (!rows) return [];
  const retrievalProvider = "retrievalProvider" in document && document.retrievalProvider === "jina-reader" ? "jina-reader" : "public-web";
  return relationships.flatMap((relationship) => {
    const relationshipIdentity = ventureRegistryIdentity(relationship.name);
    if (!relationshipIdentity) return [];
    const matches = rows.filter((row) => registryIssuerMatchesRelationship(row.name, relationship.name));
    const issuerCiks = new Set(matches.map((row) => row.cik));
    if (issuerCiks.size !== 1) return [];
    return matches.flatMap((row) => {
      const excerpt = exactSecRegistryExcerpt(document, row.raw);
      if (!excerpt) return [];
      const venue = row.exchange.toUpperCase() === "NASDAQ" ? "NASDAQ" : row.exchange.toUpperCase();
      const value = `${row.ticker} (${relationship.name}, ${venue}-listed security)`;
      return [{
        factId: factId(ctx.handle, "public_security", value),
        subjectKey: ctx.handle,
        predicate: "public_security",
        value,
        normalizedValue: canonicalBasicFactComparisonValue("public_security", searchable(value)),
        status: "verified",
        critical: true,
        questionId,
        sources: [{
          url: document.url,
          title: "SEC company ticker and exchange registry",
          sourceClass: "regulatory_or_onchain",
          relation: "supports",
          excerpt,
          contentHash: document.contentHash,
          capturedAt: document.capturedAt,
          provider: retrievalProvider,
          artifactVerified: true
        }],
        evidence_origin: "deterministic",
        artifact_verified: true,
        provider: "public-web"
      }];
    });
  });
}
function verifiedCounterpartyHosts(ctx) {
  return [...new Set(ctx.evidence.ventures.flatMap((venture) => {
    if (venture.artifact_verified !== true || venture.evidence_origin === "model_lead") return [];
    return verifiedVentureOfficialScopes(venture);
  }))];
}
var NON_NAME_IDENTITY_TOKENS = /* @__PURE__ */ new Set([
  "ceo",
  "cfo",
  "coo",
  "cto",
  "chief",
  "company",
  "dao",
  "exchange",
  "founder",
  "foundation",
  "labs",
  "network",
  "officer",
  "protocol"
]);
function plausiblePersonIdentity(value) {
  const tokens = looseTokens(value);
  return tokens.length >= 2 && tokens.length <= 6 && tokens.every((token) => !NON_NAME_IDENTITY_TOKENS.has(token));
}
function profileIdentityIsSufficient(ctx, audience) {
  const name = ctx.evidence.profile.resolved_name?.trim() || ctx.evidence.profile.display_name.trim();
  if (!name) return false;
  if (audience === "project") return true;
  const tokens = looseTokens(name);
  if (tokens.length >= 2) return true;
  if (tokens.length !== 1) return false;
  const handle = looseTokens(ctx.handle.replace(/^@/, "")).join("");
  const token = tokens[0];
  return !(handle.startsWith(token) && handle.slice(token.length).length >= 3);
}
function verifiedIdentityExtendsProfile(ctx, candidate) {
  if (!plausiblePersonIdentity(candidate)) return false;
  const current = ctx.evidence.profile.resolved_name?.trim() || ctx.evidence.profile.display_name.trim();
  const currentTokens = looseTokens(current);
  const candidateTokens = looseTokens(candidate);
  if (currentTokens.length >= 2) return personKey(current) === personKey(candidate);
  if (currentTokens.length !== 1 || !candidateTokens.includes(currentTokens[0])) return false;
  const handle = looseTokens(ctx.handle.replace(/^@/, "")).join("");
  return handle === candidateTokens.join("");
}
function applyVerifiedPersonIdentity(ctx, facts) {
  if (researchAudience(ctx) === "project") return false;
  const candidate = facts.filter((fact) => fact.predicate === "official_identity" && fact.artifact_verified === true && (fact.status === "verified" || fact.status === "corroborated") && verifiedIdentityExtendsProfile(ctx, fact.value)).sort((left, right) => looseTokens(right.value).length - looseTokens(left.value).length)[0];
  if (!candidate) return false;
  const current = ctx.evidence.profile.resolved_name?.trim() ?? "";
  if (personKey(current) === personKey(candidate.value)) return false;
  ctx.evidence.profile.resolved_name = candidate.value;
  if (ctx.evidence.profile.identity_confidence !== "Confirmed") {
    ctx.evidence.profile.identity_confidence = "Probable";
  }
  ctx.evidence.profile.identity_note = `${candidate.value} was resolved from fetched, source-backed identity evidence.`;
  return true;
}
function deterministicQuestionAnswerRefs(ctx, question, facts) {
  const refs = facts.filter((fact) => (fact.status === "verified" || fact.status === "corroborated") && (fact.questionId === question.id || fact.predicate === question.predicate) && !((question.audience === "person" || question.audience === "investor") && fact.predicate === "legal_regulatory_event" && fact.attributionScope !== "direct_subject")).map((fact) => fact.factId);
  const add = (ref) => {
    if (!refs.includes(ref)) refs.push(ref);
  };
  if (question.predicate === "official_identity" && ctx.evidence.profile.profile_collection_state === "resolved" && profileIdentityIsSufficient(ctx, question.audience)) add(`profile:${ctx.evidence.profile.profile_provider ?? "provider"}:${ctx.handle.toLowerCase()}`);
  if (question.predicate === "official_token" && ctx.evidence.projectToken?.verified) {
    add(`project-token:${ctx.evidence.projectToken.coingeckoId}`);
  }
  const verifiedTeam = (ctx.evidence.webTeam ?? []).filter((member) => member.artifact_verified === true && member.evidence_origin !== "model_lead");
  if (question.audience === "project" && question.predicate === "founder") {
    verifiedTeam.filter((member) => /\b(?:co[- ]?)?founder\b/i.test(member.role)).forEach((member) => add(`team:${personKey(member.name)}:founder`));
  }
  if (question.audience === "project" && question.predicate === "executive") {
    verifiedTeam.filter((member) => PREDICATE_PATTERNS.executive.test(member.role)).forEach((member) => add(`team:${personKey(member.name)}:executive`));
  }
  const ventures = ctx.evidence.ventures.filter((venture) => venture.artifact_verified === true && venture.evidence_origin !== "model_lead");
  if (question.predicate === "current_role") {
    ventures.filter((venture) => venture.outcome === "Active" && /\b(?:present|current|now|ongoing)\b/i.test(venture.period)).forEach((venture) => add(`venture:${searchable(venture.project_name)}:current_role`));
  }
  if (question.predicate === "founder") {
    ventures.filter((venture) => /\b(?:co[- ]?)?founder\b/i.test(venture.role)).forEach((venture) => add(`venture:${searchable(venture.project_name)}:founder`));
  }
  if (question.predicate === "investor") {
    ventures.filter((venture) => /\b(?:investor|partner|principal|venture|capital|\bgp\b)\b/i.test(venture.role)).forEach((venture) => add(`venture:${searchable(venture.project_name)}:investor`));
  }
  if (question.predicate === "track_record") {
    ventures.filter((venture) => [
      "IPO",
      "Acquisition",
      "Acquihire",
      "OrderlyWindDown",
      "Failure",
      "SilentShutdown",
      "Rug",
      "Exploit"
    ].includes(String(venture.outcome))).forEach((venture) => add(`venture:${searchable(venture.project_name)}:${searchable(String(venture.outcome))}`));
  }
  if (question.predicate === "exit") {
    ventures.filter((venture) => ["IPO", "Acquisition", "Acquihire"].includes(String(venture.outcome))).forEach((venture) => add(`venture:${searchable(venture.project_name)}:${searchable(String(venture.outcome))}`));
  }
  return refs;
}
function questionLedger(ctx, questions, facts, primary, repair, repairQuestionIds) {
  return questions.map((question) => {
    const answerRefs = deterministicQuestionAnswerRefs(ctx, question, facts);
    const questionRunState = (result) => {
      const questionSpecificState = result.questionStates?.[question.id];
      if (questionSpecificState) return questionSpecificState;
      const state = result.batchStates?.[question.batch] ?? result.state;
      return state === "completed_empty" ? "partial" : state;
    };
    const providerRuns = [{
      phase: "primary",
      provider: primary.questionProviders?.[question.id] ?? primary.provider,
      state: questionRunState(primary)
    }];
    if (repairQuestionIds.has(question.id)) {
      const repairState = questionRunState(repair);
      providerRuns.push({
        phase: "repair",
        provider: repair.questionProviders?.[question.id] ?? repair.provider,
        state: repairState
      });
    }
    return {
      questionId: question.id,
      audience: question.audience,
      batch: question.batch,
      predicate: question.predicate,
      question: question.question,
      critical: question.critical,
      status: answerRefs.length ? "answered" : "unanswered",
      answerRefs,
      providerRuns
    };
  });
}
async function collectBasicFacts(ctx, dependencies = {}) {
  const questions = basicFactsResearchQuestions(ctx);
  const discover = dependencies.discover ?? discoverPrimary;
  const fetchSource = dependencies.fetchSource ?? fetchPublicTextWithRecovery;
  if (!dependencies.discover && !env("ANTHROPIC_API_KEY") && !env("XAI_API_KEY")) {
    return { state: "skipped", detail: "basic-facts web research is not configured" };
  }
  ctx.emit({
    phase: "P0 \xB7 Intake",
    label: "Basic facts research",
    detail: "Searching for foundational facts, then independently fetching and checking every cited passage\u2026",
    source: env("ANTHROPIC_API_KEY") ? "Claude web search \xB7 public source verification" : "Grok web search \xB7 public source verification",
    tone: "neutral"
  });
  const primary = normalizeDiscoveryOutput(await discover(ctx, questions));
  const primaryLeads = selectBasicFactLeads([
    ...officialIdentityBootstrapLeads(ctx),
    ...primary.leads
  ]);
  ctx.evidence.basicFactLeads = primaryLeads.map((lead) => ({ ...lead }));
  ctx.evidence.basicFacts = [];
  let aliases = subjectAliases(ctx);
  const officialHosts = [ctx.evidence.profile.website].filter((value) => Boolean(value)).flatMap((value) => {
    try {
      return [new URL(value).toString()];
    } catch {
      return [];
    }
  });
  let officialCounterpartyHosts = verifiedCounterpartyHosts(ctx);
  const ventureAssetRelationships = verifiedVentureAssetRelationships(ctx);
  const sourceByUrl = /* @__PURE__ */ new Map();
  const fetchOnce = (url) => {
    const key = new URL(url).toString();
    const existing = sourceByUrl.get(key);
    if (existing) return existing;
    const fetchAndRecord = async (target) => {
      try {
        const result = await fetchSource(target);
        recordCall(
          "basic-facts-web",
          "source-fetch",
          0,
          result.status === "ok" ? "source_fetched" : result.reason,
          result.status === "ok" ? "succeeded" : "failed"
        );
        return result;
      } catch {
        recordCall("basic-facts-web", "source-fetch", 0, "transport_error", "failed");
        return { status: "failed", reason: "transport_error" };
      }
    };
    const pending = (async () => {
      const primary2 = await fetchAndRecord(url);
      const localized = coinbaseWrappedAssetLocaleFallback(url);
      if (!localized || isExpectedCoinbaseWrappedAssetPage(primary2, localized)) return primary2;
      const recovered = await fetchAndRecord(localized);
      return recovered.status === "ok" ? recovered : primary2;
    })();
    sourceByUrl.set(key, pending);
    return pending;
  };
  const verifyLeads = async (leads, sourceLimit, assetRelationships = ventureAssetRelationships) => {
    const variants = verificationLeadVariants(ctx, leads, officialHosts, officialCounterpartyHosts);
    const primarySources = leads.flatMap((lead) => {
      const sourceUrl = safeCandidateUrl(lead.sourceUrl);
      return sourceUrl ? [sourceUrl] : [];
    });
    const allowedSources = new Set([.../* @__PURE__ */ new Set([
      ...primarySources,
      ...variants.map(({ lead }) => lead.sourceUrl)
    ])].slice(0, sourceLimit));
    return (await Promise.all(variants.filter(({ lead }) => allowedSources.has(lead.sourceUrl)).map(async ({ lead }) => {
      const result = await fetchOnce(lead.sourceUrl);
      return result.status === "ok" ? verifyBasicFactLead(
        lead,
        result,
        aliases,
        ctx.handle,
        officialHosts,
        officialCounterpartyHosts,
        assetRelationships
      ) : null;
    }))).filter((fact) => fact !== null);
  };
  const expandVerificationContext = (facts) => {
    let changed = false;
    const relationshipScopes = verifiedFactAssetRelationships(ctx, facts).flatMap((relationship) => relationship.officialScopes);
    const nextCounterpartyHosts = [.../* @__PURE__ */ new Set([
      ...officialCounterpartyHosts,
      ...relationshipScopes
    ])];
    if (nextCounterpartyHosts.length !== officialCounterpartyHosts.length) {
      officialCounterpartyHosts = nextCounterpartyHosts;
      changed = true;
    }
    if (applyVerifiedPersonIdentity(ctx, facts)) changed = true;
    const nextAliases = [.../* @__PURE__ */ new Set([...aliases, ...subjectAliases(ctx)])];
    if (nextAliases.length !== aliases.length) {
      aliases = nextAliases;
      changed = true;
    }
    return changed;
  };
  const verifyWithExpandedContext = async (leads, sourceLimit, assetRelationships = ventureAssetRelationships) => {
    const candidates = [];
    for (let pass = 0; pass < 3; pass += 1) {
      candidates.push(...await verifyLeads(leads, sourceLimit, assetRelationships));
      const published = resolveBasicFactCandidates(candidates);
      if (!expandVerificationContext(published)) break;
    }
    return candidates;
  };
  const primaryVerified = await verifyWithExpandedContext(primaryLeads, MAX_SOURCES);
  const primaryFacts = resolveBasicFactCandidates(primaryVerified);
  const missingCritical = questions.filter((question) => question.critical && deterministicQuestionAnswerRefs(ctx, question, primaryFacts).length === 0);
  const repairQuestions = boundedRepairQuestions(missingCritical);
  let repair = {
    provider: "none",
    state: "skipped",
    leads: [],
    attempts: 0,
    completedBatches: 0,
    failedBatches: 0,
    detail: missingCritical.length ? "repair provider not configured" : "no critical gaps"
  };
  if (repairQuestions.length && (dependencies.repair || !dependencies.discover)) {
    const output = dependencies.repair ? await dependencies.repair(ctx, repairQuestions) : await discoverRepair(ctx, repairQuestions);
    repair = normalizeDiscoveryOutput(output);
    if (missingCritical.length > repairQuestions.length) {
      repair.detail = [
        repair.detail,
        `${repairQuestions.length}/${missingCritical.length} critical gaps searched within the repair budget`
      ].filter(Boolean).join("; ");
    }
  }
  const repairLeads = selectBasicFactLeads(repair.leads);
  const repairVerified = await verifyWithExpandedContext(repairLeads, Math.min(12, MAX_SOURCES));
  const discoveredLeads = mergeLeads(primaryLeads, repairLeads);
  const contextualVerified = await verifyWithExpandedContext(discoveredLeads, MAX_SOURCES);
  const relationshipFactsBeforeFounderRecovery = resolveBasicFactCandidates([
    ...primaryVerified,
    ...repairVerified,
    ...contextualVerified
  ]);
  const recoveredFounderLeads = sourceBackedFounderRelationshipLeads(ctx, relationshipFactsBeforeFounderRecovery);
  const recoveredFounderVerified = await verifyWithExpandedContext(
    recoveredFounderLeads,
    Math.min(8, MAX_SOURCES)
  );
  const allLeads = mergeLeads(discoveredLeads, recoveredFounderLeads);
  const relationshipFacts = resolveBasicFactCandidates([
    ...primaryVerified,
    ...repairVerified,
    ...contextualVerified,
    ...recoveredFounderVerified
  ]);
  const authoritativeAssetRelationships = mergeVentureAssetRelationships([
    ...ventureAssetRelationships,
    ...verifiedFactAssetRelationships(ctx, relationshipFacts)
  ]);
  const relationshipBoundAssets = authoritativeAssetRelationships.length ? await verifyLeads(
    allLeads.filter((lead) => lead.predicate === "public_security" || lead.predicate === "official_token"),
    Math.min(12, MAX_SOURCES),
    authoritativeAssetRelationships
  ) : [];
  const sourceVerifiedBeforeRegistry = resolveBasicFactCandidates([
    ...primaryVerified,
    ...repairVerified,
    ...contextualVerified,
    ...recoveredFounderVerified,
    ...relationshipBoundAssets
  ]);
  let registryVerified = [];
  let registryScreenEmpty = false;
  const publicSecurityQuestion = questions.find((question) => question.predicate === "public_security");
  const registryScreenNames = [.../* @__PURE__ */ new Set([
    ...authoritativeAssetRelationships.map((relationship) => relationship.name),
    ...ctx.evidence.ventures.filter((venture) => venture.artifact_verified === true && venture.evidence_origin !== "model_lead").map((venture) => venture.project_name.trim())
  ])].filter((name) => name.length > 1);
  if (publicSecurityQuestion && registryScreenNames.length && !sourceVerifiedBeforeRegistry.some((fact) => fact.predicate === "public_security" && (fact.status === "verified" || fact.status === "corroborated"))) {
    const registry = dependencies.fetchSource ? await fetchOnce(SEC_EXCHANGE_REGISTRY_URL) : await fetchSecExchangeRegistry();
    if (registry.status === "ok") {
      registryVerified = secRegistryPublicSecurityFacts(
        ctx,
        registry,
        authoritativeAssetRelationships,
        publicSecurityQuestion.id
      );
      const registryRows = secExchangeRegistryRows(registry);
      const anyIssuerMatch = registryVerified.length > 0 || registryRows !== null && registryScreenNames.some((name) => registryRows.some((row) => registryIssuerMatchesRelationship(row.name, name)));
      registryScreenEmpty = registryRows !== null && !anyIssuerMatch;
    }
  }
  const verified = [
    ...primaryVerified,
    ...registryVerified,
    ...repairVerified,
    ...contextualVerified,
    ...recoveredFounderVerified,
    ...relationshipBoundAssets
  ];
  ctx.evidence.basicFactLeads = allLeads.map((lead) => ({ ...lead }));
  ctx.evidence.basicFacts = resolveBasicFactCandidates(verified);
  const repairQuestionIds = new Set(repairQuestions.map((question) => question.id));
  ctx.evidence.basicFactQuestionLedger = questionLedger(
    ctx,
    questions,
    ctx.evidence.basicFacts,
    primary,
    repair,
    repairQuestionIds
  );
  if (registryScreenEmpty) {
    const publicSecurityEntry = ctx.evidence.basicFactQuestionLedger.find((entry) => entry.predicate === "public_security");
    if (publicSecurityEntry && publicSecurityEntry.status === "unanswered") {
      publicSecurityEntry.providerRuns.push({ phase: "repair", provider: "sec-registry", state: "completed_empty" });
    }
  }
  const sourceVerifiedLeadCount = new Set(verified.map((fact) => `${fact.predicate}::${fact.normalizedValue}`)).size;
  const unansweredCritical = ctx.evidence.basicFactQuestionLedger.filter((entry) => entry.critical && entry.status === "unanswered").length;
  ctx.emit({
    phase: "P0 \xB7 Intake",
    label: ctx.evidence.basicFacts.length ? "Basic facts verified" : "Basic facts need review",
    detail: `${sourceVerifiedLeadCount}/${allLeads.length} leads matched subject, value, and predicate language in fetched source text; ${ctx.evidence.basicFacts.length} met the first-party or two-source publication threshold; ${unansweredCritical} critical question${unansweredCritical === 1 ? "" : "s"} remain open.`,
    source: "public-web",
    tone: ctx.evidence.basicFacts.length ? "good" : "warn"
  });
  const attempts = primary.attempts + repair.attempts;
  const providerDetail = `primary ${primary.provider}:${primary.state}; repair ${repair.provider}:${repair.state}`;
  if (!allLeads.length) {
    const completedEmpty = primary.state === "completed_empty" && (repair.state === "completed_empty" || repair.state === "skipped");
    if (completedEmpty) {
      return {
        state: "partial",
        detail: `broad search returned no source-linked basic-fact candidates; individual questions remain unresolved \xB7 ${providerDetail}`,
        attempts
      };
    }
    return {
      state: primary.state === "failed" && ["failed", "skipped"].includes(repair.state) ? "failed" : "partial",
      detail: `basic-facts discovery produced no usable leads \xB7 ${providerDetail}`,
      attempts
    };
  }
  return ctx.evidence.basicFacts.length ? { state: "executed", detail: `${ctx.evidence.basicFacts.length} verified \xB7 ${allLeads.length} leads \xB7 ${unansweredCritical} critical gaps \xB7 ${providerDetail}`, attempts } : { state: "partial", detail: `${allLeads.length} leads \xB7 0 passed source verification \xB7 ${unansweredCritical} critical gaps \xB7 ${providerDetail}`, attempts };
}
var basicFactsAdapter = {
  id: "basic-facts",
  label: "Basic facts research",
  available: () => Boolean(env("ANTHROPIC_API_KEY") || env("XAI_API_KEY")),
  run: collectBasicFacts
};

// server/adapters/offchain.ts
import { createHash as createHash6 } from "node:crypto";

// src/lib/offchainEvidence.ts
var asRecord4 = (value) => value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
var aggregateStatus2 = (attempts) => {
  if (!attempts.length) return "succeeded";
  if (attempts.every((attempt) => attempt.status === "succeeded")) return "succeeded";
  if (attempts.every((attempt) => attempt.status === "failed")) return "failed";
  return "partial";
};
var sha256 = async (value) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};
var decode = (value) => value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/<[^>]+>/g, "").trim();
var tag = (block, name) => {
  const match = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return match ? decode(match[1].replace(/<!\[CDATA\[|\]\]>/g, "")) : null;
};
async function searchNewsPhrase(phrase, fetcher) {
  const scoped = `"${phrase}" (crypto OR token OR web3 OR blockchain OR NFT)`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(scoped)}&hl=en-US&gl=US&ceid=US:en`;
  let response;
  try {
    response = await fetcher(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; ARGUS/1.0)" },
      signal: AbortSignal.timeout(9e3)
    });
  } catch {
    return {
      articles: [],
      attempt: { provider: "google-news", operation: "rss-search", status: "failed", detail: "transport_error" }
    };
  }
  if (!response.ok) {
    return {
      articles: [],
      attempt: { provider: "google-news", operation: "rss-search", status: "failed", detail: `http_${response.status}` }
    };
  }
  let xml;
  try {
    xml = await response.text();
  } catch {
    return {
      articles: [],
      attempt: { provider: "google-news", operation: "rss-search", status: "failed", detail: "response_text_error" }
    };
  }
  if (!/<(?:rss|feed)\b/i.test(xml) || !/<(?:channel|entry)\b/i.test(xml)) {
    return {
      articles: [],
      attempt: { provider: "google-news", operation: "rss-search", status: "failed", detail: "response_xml_error" }
    };
  }
  const items = xml.split(/<item>/).slice(1).map((block) => block.split("</item>")[0]);
  const articles = items.map((block) => {
    const rawTitle = tag(block, "title") ?? "";
    const source2 = tag(block, "source") ?? (rawTitle.includes(" - ") ? rawTitle.split(" - ").pop() ?? "" : "");
    const title = source2 && rawTitle.endsWith(` - ${source2}`) ? rawTitle.slice(0, -(source2.length + 3)) : rawTitle;
    const link = tag(block, "link");
    const published = tag(block, "pubDate");
    const description = tag(block, "description") ?? "";
    const parsedDate = published ? Date.parse(published) : Number.NaN;
    return {
      title,
      source: source2,
      url: link,
      publishedAt: Number.isFinite(parsedDate) ? parsedDate : null,
      blob: `${title} ${description}`.toLowerCase()
    };
  }).filter((article) => Boolean(article.title && article.url));
  const invalidItems = items.length - articles.length;
  const status = invalidItems === 0 ? "succeeded" : articles.length ? "partial" : "failed";
  return {
    articles,
    attempt: {
      provider: "google-news",
      operation: "rss-search",
      status,
      detail: invalidItems ? `dropped_${invalidItems}_invalid_items` : `${articles.length}_results`
    }
  };
}
function normalizeNewsSubject(rawName, rawHandle) {
  const name = rawName.trim().replace(/[^\p{L}\p{N}\s.'-]/gu, " ").replace(/\s+/g, " ").trim();
  const handleCandidate = rawHandle.trim().replace(/^@/, "");
  const handle = /^[A-Za-z0-9_]{1,30}$/.test(handleCandidate) ? handleCandidate : "";
  if (!name && !handle) return null;
  const phrases = [];
  if (name && name.split(/\s+/).length >= 2) phrases.push(name);
  if (handle) phrases.push(handle);
  if (!phrases.length && name) phrases.push(name);
  return { name, handle, phrases: [...new Set(phrases)] };
}
function containsExactPhrase(value, phrase) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}($|[^\\p{L}\\p{N}_])`, "iu").test(value);
}
async function collectNews(rawName, rawHandle, fetcher = fetch) {
  const subject = normalizeNewsSubject(rawName, rawHandle);
  if (!subject) throw new Error("news subject required");
  const seen = /* @__PURE__ */ new Set();
  const articles = [];
  const attempts = [];
  const matches = {};
  for (const phrase of subject.phrases) {
    const result = await searchNewsPhrase(phrase, fetcher);
    attempts.push(result.attempt);
    const normalizedPhrase = phrase.toLowerCase();
    for (const article of result.articles.filter((candidate) => containsExactPhrase(candidate.blob, normalizedPhrase))) {
      const key = (article.url ?? article.title).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      matches[key] = subject.handle && normalizedPhrase === subject.handle.toLowerCase() ? "exact_handle" : "exact_name";
      articles.push({
        title: article.title,
        source: article.source,
        url: article.url,
        publishedAt: article.publishedAt
      });
    }
  }
  articles.sort((left, right) => (right.publishedAt ?? 0) - (left.publishedAt ?? 0));
  return {
    value: {
      available: true,
      query: subject.phrases[0] ?? subject.name,
      articles: articles.slice(0, 10)
    },
    attempts,
    status: aggregateStatus2(attempts),
    matches
  };
}
function normalizeResolvedName(value) {
  return value.trim().replace(/^@/, "").slice(0, 80);
}
function isPlausibleFullName(value) {
  return normalizeResolvedName(value).split(/\s+/).filter(Boolean).length >= 2;
}
var normalizedWords2 = (value) => value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
function legalCaptionHasFullName(caseName, resolvedName) {
  const nameWords = normalizedWords2(resolvedName);
  if (nameWords.length < 2) return false;
  const caption = ` ${normalizedWords2(caseName).join(" ")} `;
  const forward = ` ${nameWords.join(" ")} `;
  const reverse = ` ${[nameWords.at(-1), ...nameWords.slice(0, -1)].join(" ")} `;
  return caption.includes(forward) || caption.includes(reverse);
}
var COURTLISTENER = "https://www.courtlistener.com/api/rest/v4/search/";
async function collectLegalCases(rawName, fetcher = fetch) {
  const name = normalizeResolvedName(rawName);
  if (!isPlausibleFullName(name)) {
    return {
      value: { available: false, note: "Legal screen needs a resolved real name." },
      attempts: [],
      status: "succeeded"
    };
  }
  const url = `${COURTLISTENER}?q=${encodeURIComponent(`"${name}"`)}&type=r&order_by=${encodeURIComponent("dateFiled desc")}`;
  let response;
  try {
    response = await fetcher(url, {
      headers: { "user-agent": "ARGUS due-diligence (contact via argus)" },
      signal: AbortSignal.timeout(12e3)
    });
  } catch (error) {
    return {
      value: { available: false, error: String(error), note: "Legal screen failed." },
      attempts: [{ provider: "courtlistener", operation: "case-search", status: "failed", detail: "transport_error" }],
      status: "failed"
    };
  }
  if (!response.ok) {
    return {
      value: { available: false, note: `CourtListener ${response.status}` },
      attempts: [{ provider: "courtlistener", operation: "case-search", status: "failed", detail: `http_${response.status}` }],
      status: "failed"
    };
  }
  let parsed;
  try {
    parsed = asRecord4(await response.json()) ?? {};
  } catch (error) {
    return {
      value: { available: false, error: String(error), note: "Legal screen failed." },
      attempts: [{ provider: "courtlistener", operation: "case-search", status: "failed", detail: "response_json_error" }],
      status: "failed"
    };
  }
  const resultShapeValid = Array.isArray(parsed.results);
  const rows = resultShapeValid ? parsed.results : [];
  let malformedRows = 0;
  const cases = rows.slice(0, 20).flatMap((candidate) => {
    const row = asRecord4(candidate);
    if (!row) {
      malformedRows += 1;
      return [];
    }
    const rawCaseName = typeof row.caseName === "string" ? row.caseName : typeof row.case_name_full === "string" ? row.case_name_full : "";
    const caseName = rawCaseName.trim().slice(0, 90);
    if (!caseName) {
      malformedRows += 1;
      return [];
    }
    const absoluteUrl = typeof row.docket_absolute_url === "string" && row.docket_absolute_url.startsWith("/") && !row.docket_absolute_url.startsWith("//") ? row.docket_absolute_url : null;
    const court = typeof row.court === "string" ? row.court : typeof row.court_citation_string === "string" ? row.court_citation_string : "";
    return [{
      caseName,
      court: court.slice(0, 60),
      date: row.dateFiled ?? row.dateTerminated ?? null,
      docket: row.docketNumber ?? null,
      url: absoluteUrl ? `https://www.courtlistener.com${absoluteUrl}` : null,
      nameInCase: legalCaptionHasFullName(caseName, name)
    }];
  });
  const countValid = typeof parsed.count === "number" && Number.isFinite(parsed.count) && parsed.count >= 0;
  const total = countValid ? Math.floor(parsed.count) : cases.length;
  const resultCountMismatch = total > 0 && rows.length === 0;
  const truncated = total > cases.length || rows.length > cases.length || typeof parsed.next === "string" && Boolean(parsed.next);
  const value = {
    available: true,
    name,
    total: parsed.count ?? cases.length,
    cases,
    asParty: cases.filter((item) => item.nameInCase).length
  };
  const attemptStatus = !resultShapeValid || resultCountMismatch || rows.length > 0 && cases.length === 0 ? "failed" : !countValid || malformedRows || truncated ? "partial" : "succeeded";
  const attempt = {
    provider: "courtlistener",
    operation: "case-search",
    status: attemptStatus,
    detail: !resultShapeValid ? "result_shape_error" : resultCountMismatch ? "result_count_mismatch" : !countValid ? "invalid_result_count" : malformedRows ? `dropped_${malformedRows}_invalid_results` : truncated ? `${cases.length}_of_${total}_results` : `${cases.length}_results`
  };
  return { value, attempts: [attempt], status: attempt.status };
}
var OFAC_SOURCE = "https://data.opensanctions.org/datasets/latest/us_ofac_sdn/targets.simple.csv";
var OFAC_MIN_PERSON_NAMES = 5e3;
var OFAC_SOURCE_URL = OFAC_SOURCE;
function normalizeSanctionsName(value) {
  return value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\b(mr|mrs|ms|dr|prof|sir|dame|the)\b/g, " ").replace(/\s+/g, " ").trim();
}
function firstCsvFields(line, count) {
  const fields = [];
  let index = 0;
  while (fields.length < count && index <= line.length) {
    let field = "";
    if (line[index] === '"') {
      index += 1;
      while (index < line.length) {
        if (line[index] === '"') {
          if (line[index + 1] === '"') {
            field += '"';
            index += 2;
            continue;
          }
          index += 1;
          break;
        }
        field += line[index];
        index += 1;
      }
      if (line[index] === ",") index += 1;
    } else {
      while (index < line.length && line[index] !== ",") {
        field += line[index];
        index += 1;
      }
      if (line[index] === ",") index += 1;
    }
    fields.push(field);
  }
  return fields;
}
function parseOfacPersonNames(csv) {
  const names = /* @__PURE__ */ new Set();
  const lines = csv.split("\n");
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line || !line.includes('"Person"')) continue;
    const [, schema, name, aliases] = firstCsvFields(line, 4);
    if (schema !== "Person") continue;
    for (const raw of [name, ...aliases ? aliases.split(";") : []]) {
      const normalized4 = normalizeSanctionsName(raw || "");
      if (normalized4 && normalized4.includes(" ")) names.add(normalized4);
    }
  }
  return names;
}
async function loadOfacNames(fetcher, cache) {
  try {
    const cached = await cache?.read();
    if (cached) {
      const names2 = new Set(cached.split("\n").filter(Boolean));
      if (names2.size >= OFAC_MIN_PERSON_NAMES) {
        return {
          names: names2,
          attempts: [],
          indexHash: await sha256([...names2].sort().join("\n"))
        };
      }
    }
  } catch {
  }
  let response;
  try {
    response = await fetcher(OFAC_SOURCE, { signal: AbortSignal.timeout(2e4) });
  } catch {
    return {
      names: /* @__PURE__ */ new Set(),
      attempts: [{ provider: "opensanctions", operation: "ofac-name-index", status: "failed", detail: "transport_error" }]
    };
  }
  if (!response.ok) {
    return {
      names: /* @__PURE__ */ new Set(),
      attempts: [{ provider: "opensanctions", operation: "ofac-name-index", status: "failed", detail: `http_${response.status}` }]
    };
  }
  let csv;
  try {
    csv = await response.text();
  } catch {
    return {
      names: /* @__PURE__ */ new Set(),
      attempts: [{ provider: "opensanctions", operation: "ofac-name-index", status: "failed", detail: "response_text_error" }]
    };
  }
  const names = parseOfacPersonNames(csv);
  const validIndex = names.size >= OFAC_MIN_PERSON_NAMES;
  const attempt = {
    provider: "opensanctions",
    operation: "ofac-name-index",
    status: validIndex ? "succeeded" : "partial",
    detail: validIndex ? `${names.size}_names` : `undersized_index_${names.size}`
  };
  if (validIndex) {
    try {
      await cache?.write([...names].sort().join("\n"));
    } catch {
    }
  }
  return {
    names: validIndex ? names : /* @__PURE__ */ new Set(),
    attempts: [attempt],
    ...validIndex ? { indexHash: await sha256([...names].sort().join("\n")) } : {}
  };
}
async function collectOfacName(rawName, options = {}) {
  const name = normalizeResolvedName(rawName);
  const query = normalizeSanctionsName(name);
  if (query.split(" ").filter(Boolean).length < 2) {
    return {
      value: { available: false, note: "Sanctions screen needs a resolved real name." },
      attempts: [],
      status: "succeeded"
    };
  }
  const loaded = await loadOfacNames(options.fetcher ?? fetch, options.cache);
  if (!loaded.names.size) {
    return {
      value: { available: false, note: "OFAC SDN list unavailable." },
      attempts: loaded.attempts,
      status: aggregateStatus2(loaded.attempts)
    };
  }
  const tokens = query.split(" ");
  const reversed = [tokens[tokens.length - 1], ...tokens.slice(0, -1)].join(" ");
  return {
    value: {
      available: true,
      name,
      listSize: loaded.names.size,
      sanctioned: loaded.names.has(query) || loaded.names.has(reversed),
      list: "US Treasury OFAC SDN"
    },
    attempts: loaded.attempts,
    status: aggregateStatus2(loaded.attempts),
    indexHash: loaded.indexHash
  };
}

// src/lib/internationalSanctions.ts
var INTERNATIONAL_SANCTIONS_LISTS = [
  { key: "eu", label: "EU Consolidated Financial Sanctions", slug: "eu_fsf", minNames: 1500 },
  { key: "un", label: "UN Security Council Consolidated", slug: "un_sc_sanctions", minNames: 300 },
  { key: "uk", label: "UK Sanctions List (FCDO)", slug: "gb_fcdo_sanctions", minNames: 1500 }
];
var openSanctionsDatasetUrl = (slug) => `https://data.opensanctions.org/datasets/latest/${slug}/targets.simple.csv`;
var aggregateStatus3 = (attempts) => {
  if (!attempts.length) return "succeeded";
  if (attempts.every((attempt) => attempt.status === "succeeded")) return "succeeded";
  if (attempts.every((attempt) => attempt.status === "failed")) return "failed";
  return "partial";
};
async function loadListNames(list, fetcher) {
  const operation = `${list.slug}-name-index`;
  let response;
  try {
    response = await fetcher(openSanctionsDatasetUrl(list.slug), { signal: AbortSignal.timeout(2e4) });
  } catch {
    return { names: /* @__PURE__ */ new Set(), attempt: { provider: "opensanctions", operation, status: "failed", detail: "transport_error" } };
  }
  if (!response.ok) {
    return { names: /* @__PURE__ */ new Set(), attempt: { provider: "opensanctions", operation, status: "failed", detail: `http_${response.status}` } };
  }
  let csv;
  try {
    csv = await response.text();
  } catch {
    return { names: /* @__PURE__ */ new Set(), attempt: { provider: "opensanctions", operation, status: "failed", detail: "response_text_error" } };
  }
  const names = parseOfacPersonNames(csv);
  const valid = names.size >= list.minNames;
  return {
    names: valid ? names : /* @__PURE__ */ new Set(),
    attempt: {
      provider: "opensanctions",
      operation,
      status: valid ? "succeeded" : "partial",
      detail: valid ? `${names.size}_names` : `undersized_index_${names.size}`
    }
  };
}
async function collectInternationalSanctions(rawName, options = {}) {
  const name = normalizeResolvedName(rawName);
  const query = normalizeSanctionsName(name);
  if (query.split(" ").filter(Boolean).length < 2) {
    return {
      value: { available: false, note: "Sanctions screen needs a resolved real name." },
      attempts: [],
      status: "succeeded"
    };
  }
  const fetcher = options.fetcher ?? fetch;
  const tokens = query.split(" ");
  const reversed = [tokens[tokens.length - 1], ...tokens.slice(0, -1)].join(" ");
  const loaded = await Promise.all(
    INTERNATIONAL_SANCTIONS_LISTS.map(
      (list) => loadListNames(list, fetcher).then((result) => ({ list, ...result }))
    )
  );
  const attempts = loaded.map((entry) => entry.attempt);
  const results = loaded.map(({ list, names }) => ({
    key: list.key,
    label: list.label,
    sourceUrl: openSanctionsDatasetUrl(list.slug),
    available: names.size > 0,
    listSize: names.size,
    sanctioned: names.has(query) || names.has(reversed)
  }));
  const screened = results.filter((result) => result.available);
  if (!screened.length) {
    return {
      value: { available: false, note: "EU, UN, and UK sanctions lists were all unavailable." },
      attempts,
      status: aggregateStatus3(attempts)
    };
  }
  const matched = screened.filter((result) => result.sanctioned);
  return {
    value: {
      available: true,
      name,
      results,
      sanctioned: matched.length > 0,
      matchedLists: matched.map((result) => result.label),
      screenedLists: screened.map((result) => result.label)
    },
    attempts,
    status: aggregateStatus3(attempts)
  };
}

// server/adapters/profilePhoto.ts
import { createHash as createHash5 } from "node:crypto";
var ANTHROPIC_URL3 = "https://api.anthropic.com/v1/messages";
var MAX_IMAGE_BYTES = 75e4;
var MIN_IMAGE_BYTES = 256;
var MIN_ACTIONABLE_CONFIDENCE = 0.7;
var REDIRECT_STATUSES = /* @__PURE__ */ new Set([301, 302, 303, 307, 308]);
var IMAGE_TYPES = /* @__PURE__ */ new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
var CLASSIFICATIONS = /* @__PURE__ */ new Set([
  "real_candid",
  "studio_or_stock",
  "ai_generated",
  "celebrity_or_public_figure",
  "logo_or_cartoon",
  "no_photo",
  "unclear"
]);
var REVIEW_LEADS = /* @__PURE__ */ new Set([
  "studio_or_stock",
  "ai_generated",
  "celebrity_or_public_figure"
]);
var sha2562 = (value) => createHash5("sha256").update(value).digest("hex");
function safeOfficialAvatarUrl(raw) {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    const allowedHost = host === "pbs.twimg.com" || host === "abs.twimg.com" || host.endsWith(".twimg.com");
    if (url.protocol !== "https:" || !allowedHost || url.username || url.password || url.port && url.port !== "443") return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}
async function readBoundedImage(response) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) return null;
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (; ; ) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  if (total < MIN_IMAGE_BYTES) return null;
  return Buffer.concat(chunks, total);
}
function matchesImageSignature(bytes, mediaType) {
  if (mediaType === "image/jpeg") return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mediaType === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mediaType === "image/gif") return bytes.subarray(0, 6).toString("ascii") === "GIF87a" || bytes.subarray(0, 6).toString("ascii") === "GIF89a";
  if (mediaType === "image/webp") return bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  return false;
}
async function fetchTrustedProfileImage(rawUrl) {
  let url = safeOfficialAvatarUrl(rawUrl);
  if (!url) {
    recordCall("x-avatar", "image-fetch", 0, "unsafe_or_untrusted_url", "failed");
    return null;
  }
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    let response;
    try {
      response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(7e3),
        headers: { "user-agent": "argus-osint/1.0" }
      });
    } catch {
      recordCall("x-avatar", "image-fetch", 0, "transport_error", "failed");
      return null;
    }
    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get("location");
      let next;
      try {
        next = location ? safeOfficialAvatarUrl(new URL(location, url).toString()) : null;
      } catch {
        next = null;
      }
      if (!next || redirect === 3) {
        recordCall("x-avatar", "image-fetch", 0, "unsafe_or_excessive_redirect", "failed");
        return null;
      }
      url = next;
      continue;
    }
    if (!response.ok) {
      recordCall("x-avatar", "image-fetch", 0, `http_${response.status}`, "failed");
      return null;
    }
    const mediaType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!IMAGE_TYPES.has(mediaType)) {
      recordCall("x-avatar", "image-fetch", 0, "unsupported_content_type", "failed");
      return null;
    }
    const bytes = await readBoundedImage(response);
    if (!bytes || !matchesImageSignature(bytes, mediaType)) {
      recordCall("x-avatar", "image-fetch", 0, "empty_oversized_or_invalid_image", "failed");
      return null;
    }
    recordCall("x-avatar", "image-fetch", 0, `${bytes.length} bytes`, "succeeded");
    return { bytes, mediaType, url: url.toString(), contentHash: sha2562(bytes) };
  }
  return null;
}
function validateVisionInput(value) {
  if (!value || typeof value !== "object") return null;
  const raw = value;
  if (typeof raw.classification !== "string" || !CLASSIFICATIONS.has(raw.classification)) return null;
  if (typeof raw.confidence !== "number" || !Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1) return null;
  if (typeof raw.is_real_person !== "boolean" || typeof raw.flag !== "boolean") return null;
  if (typeof raw.note !== "string" || !raw.note.trim()) return null;
  if (!Array.isArray(raw.tells) || raw.tells.some((tell) => typeof tell !== "string")) return null;
  const classification = raw.classification;
  return {
    classification,
    confidence: raw.confidence,
    isRealPerson: raw.is_real_person,
    // Classification drives the product signal; a contradictory model boolean
    // cannot silently clear or manufacture a finding.
    flag: REVIEW_LEADS.has(classification),
    tells: raw.tells.map((tell) => String(tell).trim().slice(0, 120)).filter(Boolean).slice(0, 6),
    note: raw.note.trim().slice(0, 500)
  };
}
async function classifyImage(image) {
  const key = env("ANTHROPIC_API_KEY");
  if (!key) return null;
  let response;
  try {
    response = await fetch(ANTHROPIC_URL3, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: ANALYST_MODEL,
        max_tokens: 500,
        system: "You are screening a crypto/tech account's profile image for due diligence. This is visual triage, not identity proof and not reverse-image search. Classify only what is visible. A professional headshot or public figure may be legitimate, so those are review leads rather than fraud findings. Never identify a person by name.",
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.bytes.toString("base64") } },
            { type: "text", text: "Classify the profile image and list concrete visible tells. Use the record_profile_photo tool." }
          ]
        }],
        tools: [{
          name: "record_profile_photo",
          description: "Record a bounded visual profile-image integrity assessment.",
          input_schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              classification: { type: "string", enum: [...CLASSIFICATIONS].filter((value) => value !== "no_photo") },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              is_real_person: { type: "boolean" },
              flag: { type: "boolean" },
              tells: { type: "array", maxItems: 6, items: { type: "string" } },
              note: { type: "string" }
            },
            required: ["classification", "confidence", "is_real_person", "flag", "tells", "note"]
          }
        }],
        tool_choice: { type: "tool", name: "record_profile_photo" }
      }),
      signal: AbortSignal.timeout(25e3)
    });
  } catch {
    addClaudeUsage(void 0, "profile-photo-integrity", "failed", "transport_error");
    return null;
  }
  if (!response.ok) {
    addClaudeUsage(void 0, "profile-photo-integrity", "failed", `http_${response.status}`);
    return null;
  }
  let body;
  try {
    body = await response.json();
  } catch {
    addClaudeUsage(void 0, "profile-photo-integrity", "failed", "response_json_error");
    return null;
  }
  const tool = body.content?.find((item) => item.type === "tool_use" && item.name === "record_profile_photo");
  const parsed = validateVisionInput(tool?.input);
  addClaudeUsage(
    body.usage,
    "profile-photo-integrity",
    parsed ? "succeeded" : "partial",
    parsed ? void 0 : "invalid_tool_result"
  );
  return parsed;
}
function addArtifact(ctx, artifact) {
  const exists = ctx.evidence.sourceArtifacts.some(
    (candidate) => candidate.kind === artifact.kind && candidate.contentHash === artifact.contentHash
  );
  if (!exists) ctx.evidence.sourceArtifacts.push(artifact);
}
async function collectProfilePhoto(ctx) {
  const capturedAt = (/* @__PURE__ */ new Date()).toISOString();
  const profileUrl = `https://x.com/${encodeURIComponent(ctx.handle.replace(/^@/, ""))}`;
  if (ctx.evidence.profile.avatar_source_state === "none") {
    const result2 = {
      provider: "twitterapi",
      capturedAt,
      classification: "no_photo",
      flag: false,
      tells: [],
      note: "The official X profile response contained no custom profile image. This is not proof of deception or identity."
    };
    ctx.evidence.profileAuthenticity = result2;
    addArtifact(ctx, {
      kind: "profile_photo",
      provider: "twitterapi",
      title: "Official X profile-photo presence screen",
      sourceUrl: profileUrl,
      capturedAt,
      contentHash: sha2562(JSON.stringify(result2)),
      excerpt: result2.note,
      match: "screened_clear"
    });
    ctx.recordCheck?.({
      id: "profile-photo-authenticity",
      status: "checked-empty",
      note: "official X profile response contained no custom photo; visual ownership/reuse was not testable",
      provider: "twitterapi.io"
    });
    return { status: "succeeded", detail: "official profile returned no custom photo" };
  }
  if (!env("ANTHROPIC_API_KEY")) {
    ctx.recordCheck?.({
      id: "profile-photo-authenticity",
      status: "unavailable",
      note: "profile-photo integrity screen is unavailable because the vision analyst is not configured",
      provider: "claude-vision"
    });
    return { status: "failed", detail: "vision analyst is not configured" };
  }
  const avatarUrl = ctx.evidence.profile.avatar_url;
  if (!avatarUrl) {
    ctx.recordCheck?.({
      id: "profile-photo-authenticity",
      status: "unavailable",
      note: "official X avatar source was not resolved; no photo conclusion was recorded",
      provider: "twitterapi.io"
    });
    return { status: "failed", detail: "official avatar source unavailable" };
  }
  const image = await fetchTrustedProfileImage(avatarUrl);
  if (!image) {
    ctx.recordCheck?.({
      id: "profile-photo-authenticity",
      status: "unavailable",
      note: "official X avatar bytes could not be fetched safely; no photo conclusion was recorded",
      provider: "x-avatar"
    });
    return { status: "failed", detail: "trusted avatar fetch failed" };
  }
  const classified = await classifyImage(image);
  if (!classified) {
    ctx.recordCheck?.({
      id: "profile-photo-authenticity",
      status: "unavailable",
      note: "vision provider failed or returned an invalid profile-photo result",
      provider: "claude-vision"
    });
    return { status: "failed", detail: "vision result unavailable or invalid" };
  }
  const conclusive = classified.classification !== "unclear" && (classified.confidence ?? 0) >= MIN_ACTIONABLE_CONFIDENCE;
  const result = {
    provider: "claude-vision",
    capturedAt,
    imageUrl: image.url,
    imageData: `data:${image.mediaType};base64,${image.bytes.toString("base64")}`,
    mediaType: image.mediaType,
    imageContentHash: image.contentHash,
    ...classified,
    flag: conclusive && classified.flag,
    note: [
      classified.note,
      classified.classification === "real_candid" ? "A visually plausible personal photo does not prove ownership or identity." : classified.classification === "studio_or_stock" ? "A professional headshot can be legitimate; treat this only as a review lead." : classified.classification === "celebrity_or_public_figure" ? "A public figure may legitimately use their own image; verify identity before drawing a conclusion." : classified.classification === "ai_generated" ? "This is a vision-model lead and requires human or reverse-image verification." : "Visual classification does not establish who owns or originally published the image."
    ].join(" ").slice(0, 700)
  };
  ctx.evidence.profileAuthenticity = result;
  const artifactRecord = {
    imageContentHash: image.contentHash,
    model: ANALYST_MODEL,
    classification: result.classification,
    confidence: result.confidence,
    flag: result.flag,
    tells: result.tells,
    note: result.note
  };
  const artifactHash3 = sha2562(JSON.stringify(artifactRecord));
  addArtifact(ctx, {
    kind: "profile_photo",
    provider: "claude-vision",
    title: "Profile-photo integrity screen",
    sourceUrl: image.url,
    capturedAt,
    contentHash: artifactHash3,
    sourceContentHash: image.contentHash,
    excerpt: `${result.classification.replace(/_/g, " ")} \xB7 ${result.note}`,
    match: conclusive && result.flag ? "risk_signal" : conclusive ? "observed" : "candidate"
  });
  if (!conclusive) {
    ctx.recordCheck?.({
      id: "profile-photo-authenticity",
      status: "unavailable",
      note: `vision result was ${result.classification} at ${Math.round((result.confidence ?? 0) * 100)}% confidence; no clean conclusion recorded`,
      provider: "claude-vision",
      sourceCount: 1
    });
    return { status: "partial", detail: "vision result was inconclusive" };
  }
  ctx.recordCheck?.({
    id: "profile-photo-authenticity",
    status: result.flag ? "finding" : "checked-empty",
    note: result.flag ? `${result.classification.replace(/_/g, " ")} review lead at ${Math.round((result.confidence ?? 0) * 100)}% model confidence; not identity proof` : `${result.classification.replace(/_/g, " ")} observed; visual-only screen cannot prove image ownership or identity`,
    provider: "claude-vision",
    sourceCount: 1
  });
  return { status: "succeeded", detail: `${result.classification} at ${Math.round((result.confidence ?? 0) * 100)}%` };
}

// server/adapters/offchain.ts
var asIso = (value) => {
  if (typeof value === "number" || typeof value === "string") {
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  return void 0;
};
var hashArtifact = (artifact) => createHash6("sha256").update(JSON.stringify({
  kind: artifact.kind,
  provider: artifact.provider,
  title: artifact.title,
  sourceUrl: artifact.sourceUrl,
  publishedAt: artifact.publishedAt ?? null,
  excerpt: artifact.excerpt ?? null,
  match: artifact.match,
  sourceContentHash: artifact.sourceContentHash ?? null
})).digest("hex");
var addArtifact2 = (ctx, input) => {
  const artifact = { ...input, contentHash: hashArtifact(input) };
  const exists = ctx.evidence.sourceArtifacts.some(
    (candidate) => candidate.provider === artifact.provider && candidate.kind === artifact.kind && candidate.sourceUrl === artifact.sourceUrl
  );
  if (!exists) ctx.evidence.sourceArtifacts.push(artifact);
};
var addFinding = (ctx, finding) => {
  const exists = ctx.evidence.findings.some(
    (candidate) => candidate.finding_type === finding.finding_type && candidate.source_url === finding.source_url && candidate.claim === finding.claim
  );
  if (!exists) ctx.evidence.findings.push(finding);
};
var recordAttempts = (attempts) => {
  for (const attempt of attempts) {
    recordCall(attempt.provider, attempt.operation, 0, attempt.detail, attempt.status);
  }
};
var resolvedRealName = (ctx) => {
  const confidence = ctx.evidence.profile.identity_confidence;
  const explicitName = ctx.evidence.profile.resolved_name?.trim() ?? "";
  const projectOnly = ctx.evidence.roles.length > 0 && ctx.evidence.roles.every((role) => role === "PROJECT");
  const hasPersonRole = ctx.evidence.roles.some((role) => role !== "PROJECT");
  const confirmedDisplayName = confidence === "Confirmed" && hasPersonRole ? ctx.evidence.profile.display_name.trim() : "";
  const name = explicitName || confirmedDisplayName;
  const resolved = explicitName ? confidence === "Confirmed" || confidence === "Probable" : confidence === "Confirmed";
  return resolved && !projectOnly && isPlausibleFullName(name) ? name : null;
};
function hasResolvedRealName(ctx) {
  return resolvedRealName(ctx) !== null;
}
var failedCheckNote = (label, status, attempts) => {
  const details = attempts.filter((attempt) => attempt.status !== "succeeded").map((attempt) => attempt.detail).filter((detail) => Boolean(detail));
  return `${label} ${status === "partial" ? "completed only partially" : "was unavailable"}${details.length ? ` (${[...new Set(details)].join(", ")})` : ""}`;
};
var incompleteSingleNameQuery = (ctx, resolvedName) => {
  if (resolvedName || ctx.evidence.roles.every((role) => role === "PROJECT")) return false;
  const display = ctx.evidence.profile.display_name.trim();
  const displayToken = display.toLowerCase().replace(/[^a-z0-9]/g, "");
  const handle = ctx.handle.replace(/^@/, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return Boolean(
    displayToken && !isPlausibleFullName(display) && handle.startsWith(displayToken) && handle.slice(displayToken.length).length >= 3
  );
};
var freezeNewsOutcome = (ctx, news, capturedAt, provisionalNameQuery) => {
  if (news.status !== "succeeded") {
    ctx.recordCheck?.({
      id: "news-press",
      status: "unavailable",
      note: failedCheckNote("Google News search", news.status, news.attempts),
      provider: "google-news"
    });
  } else if (provisionalNameQuery && !news.value.articles.length) {
    ctx.recordCheck?.({
      id: "news-press",
      status: "unavailable",
      note: "single-name and handle search returned no matching article; a verified full-name search is still required",
      provider: "google-news"
    });
  } else {
    ctx.recordCheck?.({
      id: "news-press",
      status: news.value.articles.length ? "confirmed" : "checked-empty",
      note: news.value.articles.length ? `${news.value.articles.length} exact-name or exact-handle crypto press result${news.value.articles.length === 1 ? "" : "s"} frozen` : "exact-name and exact-handle crypto press searches returned no matching article",
      provider: "google-news",
      sourceCount: news.value.articles.length
    });
  }
  for (const article of news.value.articles) {
    if (!article.url) continue;
    addArtifact2(ctx, {
      kind: "press",
      provider: "google-news",
      title: article.title,
      sourceUrl: article.url,
      capturedAt,
      ...asIso(article.publishedAt) ? { publishedAt: asIso(article.publishedAt) } : {},
      excerpt: article.source,
      match: news.matches[(article.url ?? article.title).toLowerCase()] ?? "exact_name"
    });
  }
};
var freezeLegalOutcome = (ctx, legal, name, capturedAt) => {
  const exactCases = legal.value.available ? legal.value.cases.filter((item) => legalCaptionHasFullName(item.caseName, name)) : [];
  const inspectableCases = exactCases.filter(
    (item) => Boolean(item.url)
  );
  const legalIncomplete = !legal.value.available || legal.status !== "succeeded" || inspectableCases.length !== exactCases.length;
  if (legalIncomplete) {
    ctx.recordCheck?.({
      id: "us-legal-history",
      status: "unavailable",
      note: inspectableCases.length !== exactCases.length ? "CourtListener returned a matching caption without an inspectable docket URL" : failedCheckNote("CourtListener search", legal.status, legal.attempts),
      provider: "courtlistener",
      sourceCount: inspectableCases.length
    });
  } else {
    ctx.recordCheck?.({
      id: "us-legal-history",
      status: exactCases.length ? "finding" : "checked-empty",
      note: exactCases.length ? `${exactCases.length} CourtListener case caption${exactCases.length === 1 ? "" : "s"} contained the full resolved name; identity match requires review${legal.status === "partial" ? " (other returned rows were malformed)" : ""}` : "CourtListener returned no case caption containing the full resolved name",
      provider: "courtlistener",
      sourceCount: exactCases.length
    });
  }
  for (const item of inspectableCases) {
    addArtifact2(ctx, {
      kind: "legal_case",
      provider: "courtlistener",
      title: item.caseName || "CourtListener case",
      sourceUrl: item.url,
      capturedAt,
      ...asIso(item.date) ? { publishedAt: asIso(item.date) } : {},
      excerpt: [item.court, item.docket == null ? "" : String(item.docket)].filter(Boolean).join(" \xB7 "),
      match: "candidate"
    });
    addFinding(ctx, {
      finding_type: "LegalCaseNameLead",
      claim: `${name} appears by full name in the caption of ${item.caseName || "a US court record"}; verify that the named party is the audited subject.`,
      source_url: item.url,
      source_date: asIso(item.date)?.slice(0, 10) ?? "",
      source_author: "CourtListener / RECAP",
      verification_status: "Reported",
      independent_source_count: 1,
      polarity: -1,
      evidence_origin: "deterministic",
      artifact_verified: true
    });
  }
};
var freezeOfacOutcome = (ctx, ofac, name, capturedAt) => {
  if (ofac.status !== "succeeded" || !ofac.value.available) {
    ctx.recordCheck?.({
      id: "ofac-sanctions-name",
      status: "unavailable",
      note: failedCheckNote("OFAC name screen", ofac.status, ofac.attempts),
      provider: "opensanctions"
    });
    return;
  }
  ctx.recordCheck?.({
    id: "ofac-sanctions-name",
    status: ofac.value.sanctioned ? "finding" : "checked-empty",
    note: ofac.value.sanctioned ? "exact full-name or alias match in the US Treasury OFAC SDN mirror; identity match requires review" : `exact full-name and reversed-name screen completed against ${ofac.value.listSize.toLocaleString()} OFAC SDN names with no match`,
    provider: "opensanctions",
    sourceCount: 1
  });
  addArtifact2(ctx, {
    kind: "sanctions_screen",
    provider: "opensanctions",
    title: "US Treasury OFAC SDN exact-name screen",
    sourceUrl: OFAC_SOURCE_URL,
    capturedAt,
    excerpt: ofac.value.sanctioned ? `Exact name/alias match for ${name}; identity requires verification.` : `No exact full-name or reversed-name match for ${name} across ${ofac.value.listSize} indexed names.`,
    match: ofac.value.sanctioned ? "exact_name" : "no_match",
    ...ofac.indexHash ? { sourceContentHash: ofac.indexHash } : {}
  });
  if (ofac.value.sanctioned) {
    addFinding(ctx, {
      finding_type: "SanctionsNameLead",
      claim: `${name} exactly matches a person name or alias in the US Treasury OFAC SDN mirror; verify the identity before drawing a conclusion.`,
      source_url: OFAC_SOURCE_URL,
      source_date: capturedAt.slice(0, 10),
      source_author: "OpenSanctions mirror of US Treasury OFAC SDN",
      verification_status: "Reported",
      independent_source_count: 1,
      polarity: -1,
      evidence_origin: "deterministic",
      artifact_verified: true
    });
  }
};
var freezeIntlSanctionsOutcome = (ctx, collection, name, capturedAt) => {
  if (!collection.value.available) return;
  const { screenedLists, matchedLists, sanctioned, results } = collection.value;
  const matchedUrl = results.find((result) => result.sanctioned)?.sourceUrl ?? "https://data.opensanctions.org/";
  addArtifact2(ctx, {
    kind: "sanctions_screen",
    provider: "opensanctions",
    title: `EU/UN/UK consolidated sanctions exact-name screen (${screenedLists.length} lists)`,
    sourceUrl: matchedUrl,
    capturedAt,
    excerpt: sanctioned ? `Exact name or alias match for ${name} on ${matchedLists.join(", ")}; identity requires verification.` : `No exact full-name or reversed-name match for ${name} across the ${screenedLists.join(", ")}.`,
    match: sanctioned ? "exact_name" : "no_match"
  });
  if (sanctioned) {
    addFinding(ctx, {
      finding_type: "SanctionsNameLead",
      claim: `${name} exactly matches a person name or alias on ${matchedLists.join(", ")} (EU/UN/UK consolidated sanctions); verify the identity before drawing a conclusion.`,
      source_url: matchedUrl,
      source_date: capturedAt.slice(0, 10),
      source_author: "OpenSanctions (EU/UN/UK consolidated lists)",
      verification_status: "Reported",
      independent_source_count: matchedLists.length,
      polarity: -1,
      evidence_origin: "deterministic",
      artifact_verified: true
    });
  }
};
var ofacSearch = (name) => collectOfacName(name, {
  cache: {
    read: () => cacheGet("ofacname:v2", {
      operation: "ofac-name-index-hit",
      meta: "24h OFAC name-index cache"
    }),
    write: (names) => cacheSet("ofacname:v2", names)
  }
});
function resolvedOffchainName(ctx) {
  return resolvedRealName(ctx);
}
async function refreshResolvedNameOffchain(ctx) {
  const name = resolvedRealName(ctx);
  if (!name) return { state: "skipped", detail: "no newly resolved full name" };
  const capturedAt = (/* @__PURE__ */ new Date()).toISOString();
  ctx.emit({
    phase: "Off-chain",
    label: "Full-name diligence refresh",
    detail: `Refreshing exact-name news, US court, and OFAC outcomes for ${name}.`,
    tone: "neutral"
  });
  const [news, legal, ofac, intlSanctions] = await Promise.all([
    collectNews(name, ctx.handle),
    collectLegalCases(name),
    ofacSearch(name),
    collectInternationalSanctions(name)
  ]);
  recordAttempts(news.attempts);
  recordAttempts(legal.attempts);
  recordAttempts(ofac.attempts);
  recordAttempts(intlSanctions.attempts);
  freezeNewsOutcome(ctx, news, capturedAt, false);
  freezeLegalOutcome(ctx, legal, name, capturedAt);
  freezeOfacOutcome(ctx, ofac, name, capturedAt);
  freezeIntlSanctionsOutcome(ctx, intlSanctions, name, capturedAt);
  const statuses = [news.status, legal.status, ofac.status];
  const failed = statuses.filter((status) => status === "failed").length;
  const partial = statuses.filter((status) => status === "partial").length;
  const state = failed === statuses.length ? "failed" : failed || partial ? "partial" : "executed";
  return {
    state,
    detail: `full-name refresh for ${name} \xB7 ${failed} failed \xB7 ${partial} partial`
  };
}
var offchainAdapter = {
  id: "offchain-diligence",
  label: "Photo, news, legal, and sanctions",
  available: () => true,
  async run(ctx) {
    const capturedAt = (/* @__PURE__ */ new Date()).toISOString();
    const name = resolvedRealName(ctx);
    ctx.emit({
      phase: "Off-chain",
      label: "Photo / news / legal / sanctions",
      detail: name ? `Freezing the official profile-photo, exact-name news, US court, and OFAC outcomes for ${name} before scoring\u2026` : "Freezing the official profile-photo and exact-name/handle news outcomes before scoring; legal and OFAC require a resolved real person.",
      tone: "neutral"
    });
    const newsPromise = collectNews(name ?? ctx.evidence.profile.display_name, ctx.handle);
    const profilePhotoPromise = collectProfilePhoto(ctx);
    const legalPromise = name ? collectLegalCases(name) : null;
    const ofacPromise = name ? ofacSearch(name) : null;
    const intlSanctionsPromise = name ? collectInternationalSanctions(name) : null;
    const [news, profilePhoto, legal, ofac, intlSanctions] = await Promise.all([
      newsPromise,
      profilePhotoPromise,
      legalPromise ?? Promise.resolve(null),
      ofacPromise ?? Promise.resolve(null),
      intlSanctionsPromise ?? Promise.resolve(null)
    ]);
    recordAttempts(news.attempts);
    if (legal) recordAttempts(legal.attempts);
    if (ofac) recordAttempts(ofac.attempts);
    if (intlSanctions) recordAttempts(intlSanctions.attempts);
    freezeNewsOutcome(ctx, news, capturedAt, incompleteSingleNameQuery(ctx, name));
    if (legal && name) freezeLegalOutcome(ctx, legal, name, capturedAt);
    if (ofac && name) freezeOfacOutcome(ctx, ofac, name, capturedAt);
    if (intlSanctions && name) freezeIntlSanctionsOutcome(ctx, intlSanctions, name, capturedAt);
    const statuses = [news.status, profilePhoto.status, legal?.status, ofac?.status].filter(
      (status) => Boolean(status)
    );
    const failed = statuses.filter((status) => status === "failed").length;
    const partial = statuses.filter((status) => status === "partial").length;
    const state = failed === statuses.length ? "failed" : failed || partial ? "partial" : "executed";
    const artifactCount = ctx.evidence.sourceArtifacts.length;
    ctx.emit({
      phase: "Off-chain",
      label: state === "failed" ? "Off-chain screens unavailable" : "Off-chain evidence frozen",
      detail: `${artifactCount} source artifact${artifactCount === 1 ? "" : "s"} available before scoring${state === "partial" ? "; at least one provider path was incomplete" : ""}.`,
      source: "claude-vision \xB7 google-news \xB7 courtlistener \xB7 opensanctions",
      tone: state === "failed" ? "warn" : state === "partial" ? "warn" : "neutral"
    });
    return { state, detail: `${artifactCount} artifacts \xB7 ${failed} failed \xB7 ${partial} partial` };
  }
};

// server/adapters/wayback.ts
var CDX = "https://web.archive.org/cdx/search/cdx";
async function newestSnapshot(urlPath) {
  let response;
  try {
    const qs = `?url=${encodeURIComponent(urlPath)}&output=json&filter=statuscode:200&collapse=digest&limit=-1`;
    response = await fetch(CDX + qs, { signal: AbortSignal.timeout(4e3) });
  } catch {
    recordCall("wayback", "cdx-search", 0, "transport_error", "failed");
    return null;
  }
  if (!response.ok) {
    recordCall("wayback", "cdx-search", 0, `http_${response.status}`, "failed");
    return null;
  }
  let parsed;
  try {
    parsed = await response.json();
  } catch {
    recordCall("wayback", "cdx-search", 0, "response_json_error", "failed");
    return null;
  }
  if (!Array.isArray(parsed) || !parsed.every(Array.isArray)) {
    recordCall("wayback", "cdx-search", 0, "invalid_result_shape", "partial");
    return null;
  }
  const rows = parsed;
  if (rows.length < 2) {
    recordCall("wayback", "cdx-search", 0, "no_snapshot", "succeeded");
    return null;
  }
  const header = rows[0];
  const last = rows[rows.length - 1];
  const ti = header.indexOf("timestamp");
  const oi = header.indexOf("original");
  if (ti < 0 || oi < 0 || typeof last[ti] !== "string" || typeof last[oi] !== "string") {
    recordCall("wayback", "cdx-search", 0, "invalid_result_shape", "partial");
    return null;
  }
  recordCall("wayback", "cdx-search", 0, void 0, "succeeded");
  return { timestamp: last[ti], original: last[oi] };
}
async function archivedAffiliation(domain, name) {
  const clean4 = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
  if (!clean4 || !name) return null;
  const needles = nameNeedles(name);
  if (!needles.length) return null;
  const paths = [`${clean4}/team`, `${clean4}/about`, clean4];
  for (const p of paths) {
    const snap = await newestSnapshot(p);
    if (!snap) continue;
    let response;
    try {
      const archiveUrl = `https://web.archive.org/web/${snap.timestamp}id_/${snap.original}`;
      response = await fetch(archiveUrl, { signal: AbortSignal.timeout(5e3) });
      if (!response.ok) {
        recordCall("wayback", "snapshot-fetch", 0, `http_${response.status}`, "failed");
        continue;
      }
      let text2;
      try {
        text2 = (await response.text()).toLowerCase();
      } catch {
        recordCall("wayback", "snapshot-fetch", 0, "response_text_error", "failed");
        continue;
      }
      if (!text2.trim()) {
        recordCall("wayback", "snapshot-fetch", 0, "empty_snapshot", "partial");
        continue;
      }
      const matched = needles.some((n) => text2.includes(n));
      recordCall("wayback", "snapshot-fetch", 0, matched ? "name_match" : "no_name_match", "succeeded");
      if (matched) {
        return {
          url: `https://web.archive.org/web/${snap.timestamp}/${snap.original}`,
          year: snap.timestamp.slice(0, 4),
          where: p.replace(clean4, "").replace(/^\//, "") || "homepage"
        };
      }
    } catch {
      recordCall("wayback", "snapshot-fetch", 0, "transport_error", "failed");
    }
  }
  return null;
}
function nameNeedles(name) {
  const n = name.trim().toLowerCase();
  const toks = n.split(/\s+/).filter((t) => t.length > 1);
  if (toks.length < 2) return [];
  const out = /* @__PURE__ */ new Set([n, `${toks[0]} ${toks[toks.length - 1]}`]);
  return [...out];
}

// server/adapters/wallet.ts
var ADDR_IN_TEXT = /0x[a-fA-F0-9]{40}/g;
var NAME_IN_TEXT = /\b[a-z0-9][a-z0-9-]{1,38}\.(?:base\.eth|eth|sol|lens)\b/gi;
async function getJson(url) {
  let operation;
  try {
    operation = new URL(url).host;
  } catch {
    return null;
  }
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(9e3) });
  } catch {
    recordCall("wallet-resolve", operation, 0, "transport_error", "failed");
    return null;
  }
  if (!response.ok) {
    recordCall("wallet-resolve", operation, 0, `http_${response.status}`, "failed");
    return null;
  }
  let result;
  try {
    result = await response.json();
  } catch {
    recordCall("wallet-resolve", operation, 0, "response_json_error", "failed");
    return null;
  }
  if (result === null || typeof result !== "object") {
    recordCall("wallet-resolve", operation, 0, "invalid_result_shape", "partial");
    return null;
  }
  recordCall("wallet-resolve", operation, 0, void 0, "succeeded");
  return result;
}
async function web3bio(name) {
  const d = await getJson(`https://api.web3.bio/profile/${encodeURIComponent(name)}`);
  const arr = Array.isArray(d) ? d : d ? [d] : [];
  return arr.find((x) => x && typeof x.address === "string" && x.address)?.address ?? null;
}
async function ensideas(name) {
  const d = await getJson(`https://api.ensideas.com/ens/resolve/${encodeURIComponent(name)}`);
  return d && typeof d.address === "string" && /^0x[a-fA-F0-9]{40}$/.test(d.address) ? d.address : null;
}
async function snsResolve(name) {
  const j = await getJson(`https://sns-sdk-proxy.bonfida.workers.dev/resolve/${encodeURIComponent(name.replace(/\.sol$/i, ""))}`);
  return j && typeof j.result === "string" ? j.result : null;
}
async function resolveName(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".sol")) {
    const a2 = await snsResolve(lower);
    return a2 ? { address: a2, chain: "solana" } : null;
  }
  let a = await web3bio(lower);
  if (!a && /\.eth$/i.test(lower)) a = await ensideas(lower);
  return a ? { address: a, chain: a.startsWith("0x") ? "evm" : "solana" } : null;
}
async function farcasterWallets(handle) {
  const u = handle.replace(/^@/, "");
  const ud = await getJson(`https://api.warpcast.com/v2/user-by-username?username=${encodeURIComponent(u)}`);
  const fid = ud?.result?.user?.fid;
  if (!fid) return [];
  const vd = await getJson(`https://api.warpcast.com/v2/verifications?fid=${fid}`);
  const verifs = vd?.result?.verifications ?? [];
  return verifs.filter((v) => typeof v.address === "string" && /^0x[a-fA-F0-9]{40}$/.test(v.address)).map((v) => ({ address: v.address, chain: "evm", source: `Farcaster verified wallet (@${u})`, tier: "InvestigatorAttributed" }));
}
async function resolveWalletsFromText(text2) {
  if (!text2) return [];
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (address, chain, source2) => {
    if (!address) return;
    const k = address.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ address, chain, source: source2, tier: "SelfDoxxed" });
  };
  for (const m of text2.matchAll(ADDR_IN_TEXT)) add(m[0], "evm", "0x address self-disclosed in X bio/posts");
  const names = /* @__PURE__ */ new Set();
  for (const m of text2.matchAll(NAME_IN_TEXT)) names.add(m[0].toLowerCase());
  for (const nm of [...names].slice(0, 6)) {
    const r = await resolveName(nm);
    add(r?.address ?? null, r?.chain ?? "evm", `${nm} (self-disclosed in X bio/posts)`);
  }
  return out.slice(0, 6);
}
async function resolveForHandle(handle, text2, opts = {}) {
  const u = handle.replace(/^@/, "").toLowerCase();
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (w) => {
    if (!w) return;
    const k = w.address.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(w);
  };
  const [fromText, fromFc] = await Promise.all([resolveWalletsFromText(text2), farcasterWallets(handle)]);
  fromText.forEach(add);
  fromFc.forEach(add);
  if (opts.includePossible) {
    for (const nm of [`${u}.eth`, `${u}.base.eth`]) {
      const r = await resolveName(nm);
      if (r) add({ address: r.address, chain: r.chain, source: `${nm} (handle-name match, unconfirmed)`, tier: "InvestigatorAttributed" });
    }
  }
  return out.slice(0, 8);
}

// server/adapters/trustgraph.ts
import { createHash as createHash7 } from "node:crypto";

// src/lib/reportPresentation.ts
var VERDICT_COLORS = Object.freeze({
  PASS: "#16a34a",
  CAUTION: "#d97706",
  FAIL: "#ea580c",
  AVOID: "#dc2626",
  UNVERIFIABLE_IDENTITY: "#7c3aed",
  INCOMPLETE: "#a1a1aa",
  PROVISIONAL: "#d97706"
});
var ADVERSE_VERDICTS = /* @__PURE__ */ new Set([
  "CAUTION",
  "FAIL",
  "AVOID",
  "UNVERIFIABLE_IDENTITY"
]);
var FINAL_VERDICTS = /* @__PURE__ */ new Set([
  "PASS",
  ...ADVERSE_VERDICTS
]);
function normalizedCompleteness(value) {
  if (value === "complete" || value === "failed") return value;
  return "partial";
}
var TRUSTED_ATTESTATIONS = /* @__PURE__ */ new Set(["server_collected", "analyst_submitted"]);
var SUCCESSFUL_CHECK_STATES = /* @__PURE__ */ new Set(["confirmed", "finding", "checked-empty", "complete"]);
function checkRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function checkIsStale(check, nowMs) {
  const deadline = check.stale_at ?? check.staleAt;
  if (typeof deadline !== "string" || !deadline.trim()) return false;
  const deadlineMs = Date.parse(deadline);
  return Number.isFinite(deadlineMs) && deadlineMs <= nowMs;
}
function checkDecisionCriticality(value) {
  const check = checkRecord(value);
  const metadata = checkRecord(check.metadata);
  const criticality = typeof check.decisionCritical === "boolean" ? check.decisionCritical : metadata.decisionCritical;
  return typeof criticality === "boolean" ? criticality : void 0;
}
function coverageQualifiedCompleteness(input) {
  const completeness = normalizedCompleteness(input.completeness);
  if (completeness === "failed") return "failed";
  if (input.attestation !== void 0 && !TRUSTED_ATTESTATIONS.has(input.attestation)) {
    return "partial";
  }
  if (input.checks === void 0) return completeness;
  const hasExplicitCriticality = input.checks.some((value) => checkDecisionCriticality(value) !== void 0);
  const governingChecks = hasExplicitCriticality ? input.checks.filter((value) => checkDecisionCriticality(value) === true) : input.checks;
  const applicable = governingChecks.filter((value) => {
    const check = checkRecord(value);
    const metadata = checkRecord(check.metadata);
    return check.status !== "not-applicable" && check.state !== "not-applicable" && check.notApplicable !== true && metadata.notApplicable !== true;
  });
  if (!applicable.length) return "partial";
  const nowMs = Date.now();
  const rows = applicable.map((value) => {
    const check = checkRecord(value);
    const id = typeof check.checkId === "string" ? check.checkId : typeof check.check_id === "string" ? check.check_id : "";
    const recorded = !checkIsStale(check, nowMs) && SUCCESSFUL_CHECK_STATES.has(String(check.status ?? check.state ?? ""));
    return { id, recorded };
  });
  const hasStableIds = rows.some((row) => row.id);
  const recordedCount = rows.filter((row) => row.recorded).length;
  const openNeverWaive = hasStableIds && rows.some((row) => row.id && NEVER_WAIVE_CHECK_IDS.has(row.id) && !row.recorded);
  const recordedPercent = Math.floor(recordedCount / rows.length * 100);
  const coverageSufficient = hasStableIds ? !openNeverWaive && recordedPercent >= CLEARANCE_COVERAGE_FLOOR_PERCENT : recordedCount === rows.length;
  return completeness === "complete" && coverageSufficient ? "complete" : "partial";
}

// src/graph/network.ts
var EVM_ADDRESS = /^0x[0-9a-f]+$/i;
var SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
function normalizeChain(chain) {
  return String(chain).trim().toLowerCase();
}
function normalizeAddress(chain, address) {
  const value = String(address).trim();
  return normalizeChain(chain) !== "solana" && EVM_ADDRESS.test(value) ? value.toLowerCase() : value;
}
function tokenEntityKey(chain, address) {
  return `token:${normalizeChain(chain)}:${normalizeAddress(chain, address)}`;
}
function walletEntityKey(chain, address) {
  return `wallet:${normalizeChain(chain)}:${normalizeAddress(chain, address)}`;
}
function canonical(raw) {
  const value = String(raw).trim();
  let m = value.match(/^token:([^:]+):(.+)$/i);
  if (m) return tokenEntityKey(m[1], m[2]);
  m = value.match(/^(?:wallet|holder|funder):([^:]+):(.+)$/i);
  if (m) return walletEntityKey(m[1], m[2]);
  m = value.match(/^(?:token|mint):(.+)$/i);
  if (m && EVM_ADDRESS.test(m[1])) return tokenEntityKey("evm", m[1]);
  if (m && SOLANA_ADDRESS.test(m[1])) return tokenEntityKey("solana", m[1]);
  m = value.match(/^(?:wallet|holder|funder):(.+)$/i);
  if (m && EVM_ADDRESS.test(m[1])) return walletEntityKey("evm", m[1]);
  if (m && SOLANA_ADDRESS.test(m[1])) return walletEntityKey("solana", m[1]);
  m = value.match(/^([^:]+):(.+)$/);
  if (m && (EVM_ADDRESS.test(m[2]) || normalizeChain(m[1]) === "solana" && SOLANA_ADDRESS.test(m[2]))) {
    return walletEntityKey(m[1], m[2]);
  }
  if (SOLANA_ADDRESS.test(value)) return value;
  const lower = value.toLowerCase().replace(/\s+/g, "");
  if (lower.startsWith("$")) return lower;
  return lower.replace(/^@/, "");
}
var GENERIC_KEYS = /* @__PURE__ */ new Set([
  "site",
  "website",
  "web",
  "twitter",
  "x",
  "telegram",
  "discord",
  "github",
  "docs",
  "documentation",
  "medium",
  "linktree",
  "whitepaper",
  "mail",
  "email",
  "youtube",
  "tiktok",
  "instagram",
  "reddit",
  "facebook",
  "warpcast",
  "farcaster",
  "coingecko",
  "dexscreener",
  "linkedin",
  "blog",
  "other",
  "unknown"
]);
var isGenericKey = (raw) => GENERIC_KEYS.has(canonical(raw));
var CONTEXT_ONLY_EDGE_TYPES = /* @__PURE__ */ new Set(["INVESTED_IN", "AFFILIATED_WITH"]);
function contextOnlyNodeKeys(contribution, resolve) {
  const byNode = /* @__PURE__ */ new Map();
  for (const edge of contribution.edges) {
    const type = String(edge.type).toUpperCase();
    for (const endpoint of [resolve(edge.src), resolve(edge.dst)]) {
      const types = byNode.get(endpoint) ?? [];
      types.push(type);
      byNode.set(endpoint, types);
    }
  }
  return new Set([...byNode.entries()].filter(([, types]) => types.length > 0 && types.every((type) => CONTEXT_ONLY_EDGE_TYPES.has(type))).map(([key]) => key));
}
function buildAliasResolver(contributions) {
  const targets = /* @__PURE__ */ new Map();
  const add = (alias, subject) => {
    const a = canonical(alias);
    if (!a) return;
    const set = targets.get(a) ?? /* @__PURE__ */ new Set();
    set.add(subject);
    targets.set(a, set);
  };
  const DOMAIN2 = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i;
  for (const c of contributions) {
    const rawSubject = c.nodes.find((n) => n.subject)?.key ?? c.handle;
    const subj = canonical(String(rawSubject));
    const addressBacked = subj.startsWith("token:");
    if (String(c.handle).startsWith("$")) add(c.handle, subj);
    if (!addressBacked) continue;
    for (const alias of c.aliases ?? []) add(alias, subj);
    const subjectNode = c.nodes.find((n) => n.subject);
    if (subjectNode) {
      if (typeof subjectNode.label === "string") add(subjectNode.label, subj);
      if (typeof subjectNode.symbol === "string") add("$" + subjectNode.symbol.replace(/^\$/, ""), subj);
    }
    for (const e of c.edges) {
      if (canonical(e.src) !== subj) continue;
      const dst = String(e.dst);
      if (e.type === "TEAM" && dst.startsWith("@")) add(dst, subj);
      else if (e.type === "LINKS" && DOMAIN2.test(dst)) add(dst, subj);
    }
  }
  const unique = /* @__PURE__ */ new Map();
  for (const [alias, ids] of targets) if (ids.size === 1) unique.set(alias, [...ids][0]);
  return (key) => {
    const id = canonical(key);
    return unique.get(id) ?? id;
  };
}
function tieStrength(rawKey) {
  const k = String(rawKey).toLowerCase();
  if (/^(code:|email:|wallet:|funder:|mint:|token:)/.test(k)) return "hard";
  if (/^(ga:|gtm:|adsense:|fbpixel:)/.test(k)) return "hard";
  if (/^risk:/.test(k)) return "hard";
  if (/^(holder|amm|dex|pool|lp|market|ip:|favicon:)/.test(k)) return "weak";
  return "medium";
}
function subjectConnections(handle, contributions, max = 12) {
  const resolve = buildAliasResolver(contributions);
  const me = resolve(handle);
  const mine = /* @__PURE__ */ new Map();
  for (const c of contributions) {
    if (resolve(c.handle) !== me) continue;
    const contextOnly = contextOnlyNodeKeys(c, resolve);
    for (const n of c.nodes) {
      if (isGenericKey(String(n.key))) continue;
      const k = resolve(n.key);
      const label = typeof n.label === "string" && n.label.trim() ? n.label : String(n.key);
      if (k !== me && !contextOnly.has(k)) mine.set(k, { label, type: String(n.type) });
    }
  }
  if (!mine.size) return [];
  const byOther = /* @__PURE__ */ new Map();
  const ensure = (id, label, verdict) => {
    if (!byOther.has(id)) byOther.set(id, { label, verdict, ties: /* @__PURE__ */ new Map(), direct: false });
    return byOther.get(id);
  };
  for (const c of contributions) {
    const other = resolve(c.handle);
    if (other === me) continue;
    const otherLabel = c.aliases?.[0] ?? (typeof c.nodes.find((n) => n.subject)?.label === "string" ? String(c.nodes.find((n) => n.subject).label) : c.handle);
    const contextOnly = contextOnlyNodeKeys(c, resolve);
    if (mine.has(other)) {
      const e = ensure(other, otherLabel, c.verdict);
      e.direct = true;
    }
    for (const n of c.nodes) {
      if (isGenericKey(String(n.key))) continue;
      const k = resolve(n.key);
      if (k !== me && k !== other && mine.has(k) && !contextOnly.has(k)) {
        const e = ensure(other, otherLabel, c.verdict);
        e.ties.set(k, { key: k, label: mine.get(k).label, type: mine.get(k).type });
      }
    }
  }
  return [...byOther.entries()].map(([, v]) => ({ other: v.label, otherVerdict: v.verdict, ties: [...v.ties.values()], direct: v.direct })).filter((x) => x.ties.length > 0 || x.direct).sort((a, b) => Number(b.direct) - Number(a.direct) || b.ties.length - a.ties.length).slice(0, max);
}

// server/adapters/trustgraph.ts
var GRAPH_LIMIT = 1e3;
var QUERY_LIMIT = 1e3;
var VERSION_CHUNK = 50;
var MAX_RESPONSE_BYTES = 25e6;
var MAX_TOTAL_NODES = 4e4;
var MAX_TOTAL_EDGES = 6e4;
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
var HASH = /^[a-f0-9]{64}$/i;
var FINAL_VERDICTS2 = /* @__PURE__ */ new Set(["PASS", "CAUTION", "FAIL", "AVOID", "UNVERIFIABLE_IDENTITY"]);
var ADVERSE_VERDICTS2 = /* @__PURE__ */ new Set(["FAIL", "AVOID"]);
var HARD_TIE_KEY = /^(?:code:|email:|wallet:|funder:|mint:|token:|ga:|gtm:|adsense:|fbpixel:)/i;
var EXPECTED_PERSON_CHECK_IDS = new Set(PERSON_CHECK_IDS);
var ACCEPTED_CHECK_CONTRACTS = [
  new Set(LEGACY_PERSON_CHECK_IDS),
  new Set(PROJECT_DILIGENCE_PERSON_CHECK_IDS),
  EXPECTED_PERSON_CHECK_IDS
];
var record = (value) => value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
var text = (value, max = 1e3) => typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
function credentials() {
  const url = env("SUPABASE_URL")?.replace(/\/$/, "");
  const key = env("SUPABASE_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SERVICE_KEY");
  return url && key ? { url, key } : null;
}
function headers3(key, extra = {}) {
  const out = {
    apikey: key,
    "content-type": "application/json",
    ...extra
  };
  if (!key.startsWith("sb_secret_")) out.authorization = `Bearer ${key}`;
  return out;
}
function queryUrl(base, table, params) {
  const url = new URL(`${base}/rest/v1/${table}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
}
async function boundedJson(response) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new Error("graph response exceeded the bounded evidence budget");
  }
  if (!response.body) return [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let body = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("graph response exceeded the bounded evidence budget");
    }
    body += decoder.decode(value, { stream: true });
  }
  body += decoder.decode();
  try {
    return body ? JSON.parse(body) : [];
  } catch {
    throw new Error("graph response was not valid JSON");
  }
}
function exactCount(response, rowCount) {
  const raw = response.headers.get("content-range")?.trim() ?? "";
  if (raw === "*/0" && rowCount === 0) return 0;
  const match = /^(\d+)-(\d+)\/(\d+)$/.exec(raw);
  if (!match) throw new Error("graph response omitted its exact row count");
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (start !== 0 || end - start + 1 !== rowCount || total !== rowCount) {
    throw new Error("graph response was truncated or inconsistently counted");
  }
  return total;
}
async function readExactRows(c, table, params) {
  const op = `trust-graph/${table.replace(/_/g, "-")}`;
  let response;
  try {
    response = await fetch(queryUrl(c.url, table, { ...params, limit: String(QUERY_LIMIT) }), {
      headers: headers3(c.key, { prefer: "count=exact" }),
      signal: AbortSignal.timeout(12e3)
    });
  } catch (error) {
    recordCall("supabase", op, 0, `transport_error \xB7 ${String(error).slice(0, 160)}`, "failed");
    throw error;
  }
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 200);
    recordCall("supabase", op, 0, `http_${response.status}${detail ? ` \xB7 ${detail}` : ""}`, "failed");
    throw new Error(`${table} read failed (${response.status}): ${detail}`);
  }
  try {
    const parsed = await boundedJson(response);
    if (!Array.isArray(parsed) || parsed.some((value) => !record(value))) {
      throw new Error(`${table} returned malformed rows`);
    }
    exactCount(response, parsed.length);
    recordCall("supabase", op, 0, `${parsed.length} exact row${parsed.length === 1 ? "" : "s"}`, "succeeded");
    return parsed;
  } catch (error) {
    recordCall("supabase", op, 0, `invalid_or_truncated_response \xB7 ${String(error).slice(0, 160)}`, "failed");
    throw error;
  }
}
function parseNode(value) {
  const row = record(value);
  const key = row ? text(row.key, 1e3) : null;
  const type = row ? text(row.type, 100) : null;
  return row && key && type ? { ...row, key, type } : null;
}
function parseEdge(value) {
  const row = record(value);
  const src = row ? text(row.src, 1e3) : null;
  const dst = row ? text(row.dst, 1e3) : null;
  const type = row ? text(row.type, 100) : null;
  return row && src && dst && type ? { ...row, src, dst, type } : null;
}
function parseGraphRows(rows) {
  let totalNodes = 0;
  let totalEdges = 0;
  const seenVersions = /* @__PURE__ */ new Set();
  return rows.map((raw) => {
    const handle = text(raw.handle, 500);
    const reportVersionId = text(raw.report_version_id, 64);
    if (!handle || !reportVersionId || !UUID.test(reportVersionId)) {
      throw new Error("authoritative graph row was not bound to a valid report version");
    }
    if (raw.provenance_state !== "server_collected") {
      throw new Error("non-authoritative graph row entered the authoritative result set");
    }
    if (seenVersions.has(reportVersionId)) {
      throw new Error("one immutable report version was bound to multiple graph subjects");
    }
    seenVersions.add(reportVersionId);
    if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges) || !Array.isArray(raw.aliases)) {
      throw new Error("authoritative graph row contained malformed graph arrays");
    }
    const nodes = raw.nodes.map(parseNode);
    const edges = raw.edges.map(parseEdge);
    if (!nodes.length || nodes.some((node) => !node) || edges.some((edge) => !edge)) {
      throw new Error("authoritative graph row contained malformed nodes or edges");
    }
    const subjects = nodes.filter((node) => node?.subject === true);
    if (subjects.length !== 1) {
      throw new Error("authoritative graph row must contain exactly one subject node");
    }
    const aliases = raw.aliases.map((value) => text(value, 300));
    if (aliases.some((alias) => !alias)) {
      throw new Error("authoritative graph row contained a malformed alias");
    }
    totalNodes += nodes.length;
    totalEdges += edges.length;
    if (totalNodes > MAX_TOTAL_NODES || totalEdges > MAX_TOTAL_EDGES) {
      throw new Error("authoritative graph exceeded the bounded reconciliation budget");
    }
    return {
      handle,
      reportVersionId: reportVersionId.toLowerCase(),
      aliases,
      nodes,
      edges
    };
  });
}
function chunk(values, size) {
  const out = [];
  for (let index = 0; index < values.length; index += size) out.push(values.slice(index, index + size));
  return out;
}
async function readVersions(c, organizationId, ids) {
  const out = /* @__PURE__ */ new Map();
  const seen = /* @__PURE__ */ new Set();
  for (const group of chunk(ids, VERSION_CHUNK)) {
    const rows = await readExactRows(c, "report_versions", {
      select: "id,verdict,completeness_state,attestation_state",
      organization_id: `eq.${organizationId}`,
      id: `in.(${group.join(",")})`
    });
    if (rows.length !== group.length) throw new Error("one or more exact graph report versions were unavailable");
    for (const raw of rows) {
      const id = text(raw.id, 64)?.toLowerCase() ?? "";
      const verdict = text(raw.verdict, 40)?.toUpperCase() ?? "";
      const completeness = raw.completeness_state;
      const attestation = raw.attestation_state;
      if (!UUID.test(id) || !group.includes(id) || completeness !== "complete" && completeness !== "partial" && completeness !== "failed" || attestation !== "server_collected" && attestation !== "analyst_submitted" && attestation !== "legacy_unattested" || seen.has(id)) {
        throw new Error("graph report-version metadata was malformed or ambiguous");
      }
      seen.add(id);
      if (!FINAL_VERDICTS2.has(verdict)) continue;
      out.set(id, { id, verdict, completeness, attestation });
    }
    if (group.some((id) => !seen.has(id))) throw new Error("graph report-version qualification was incomplete");
  }
  return out;
}
async function readChecks(c, organizationId, ids) {
  const out = new Map(ids.map((id) => [id, []]));
  for (const group of chunk(ids, VERSION_CHUNK)) {
    const rows = await readExactRows(c, "check_runs", {
      select: "check_id,report_version_id,state,stale_at,attestation_state,metadata",
      organization_id: `eq.${organizationId}`,
      report_version_id: `in.(${group.join(",")})`
    });
    for (const raw of rows) {
      const reportVersionId = text(raw.report_version_id, 64)?.toLowerCase() ?? "";
      const checkId = text(raw.check_id, 160) ?? "";
      const state = raw.state;
      const staleAt = raw.stale_at;
      const attestation = raw.attestation_state;
      const metadata = record(raw.metadata);
      if (!group.includes(reportVersionId) || !EXPECTED_PERSON_CHECK_IDS.has(checkId) || state !== "complete" && state !== "partial" && state !== "unavailable" && state !== "failed" && state !== "not_run" || staleAt !== null && (typeof staleAt !== "string" || !Number.isFinite(Date.parse(staleAt))) || attestation !== "server_collected" && attestation !== "analyst_submitted" && attestation !== "legacy_unattested" || !metadata) {
        throw new Error("graph check-run metadata was malformed or outside the requested versions");
      }
      out.get(reportVersionId).push({
        check_id: checkId,
        report_version_id: reportVersionId,
        state,
        stale_at: staleAt,
        attestation_state: attestation,
        metadata
      });
    }
  }
  return out;
}
async function readActiveVersionIds(c, organizationId, ids) {
  const out = /* @__PURE__ */ new Set();
  for (const group of chunk(ids, VERSION_CHUNK)) {
    const rows = await readExactRows(c, "reports", {
      select: "report_version_id",
      organization_id: `eq.${organizationId}`,
      report_version_id: `in.(${group.join(",")})`
    });
    for (const raw of rows) {
      const reportVersionId = text(raw.report_version_id, 64)?.toLowerCase() ?? "";
      if (!group.includes(reportVersionId) || out.has(reportVersionId)) {
        throw new Error("active report projection was malformed or ambiguously duplicated");
      }
      out.add(reportVersionId);
    }
  }
  return out;
}
function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  const row = record(value);
  if (!row) return value;
  return Object.fromEntries(
    Object.keys(row).sort().map((key) => [key, stableValue(row[key])])
  );
}
function semanticHash(value) {
  return createHash7("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}
function semanticContribution(contribution) {
  const stableJson2 = (value) => JSON.stringify(stableValue(value));
  const nodes = [...contribution.nodes].sort((a, b) => {
    const aKey = `${canonical(a.key)}
${text(a.type, 100) ?? ""}
${stableJson2(a)}`;
    const bKey = `${canonical(b.key)}
${text(b.type, 100) ?? ""}
${stableJson2(b)}`;
    return aKey.localeCompare(bKey);
  });
  const edges = [...contribution.edges].sort((a, b) => {
    const aKey = `${canonical(a.src)}
${canonical(a.dst)}
${text(a.type, 100) ?? ""}
${stableJson2(a)}`;
    const bKey = `${canonical(b.src)}
${canonical(b.dst)}
${text(b.type, 100) ?? ""}
${stableJson2(b)}`;
    return aKey.localeCompare(bKey);
  });
  return {
    handle: contribution.handle,
    aliases: [...contribution.aliases ?? []].sort((a, b) => canonical(a).localeCompare(canonical(b))),
    nodes,
    edges
  };
}
function marker(versionId) {
  return `__argus_report_version__:${versionId}`;
}
function qualification(row, version, checks, active) {
  const checkIds = new Set(checks.map((check) => check.check_id));
  const exactContract = ACCEPTED_CHECK_CONTRACTS.some((contract) => checks.length === contract.size && checkIds.size === contract.size && [...contract].every((checkId) => checkIds.has(checkId)));
  const checksAttested = exactContract && checks.every((check) => check.attestation_state === "server_collected");
  const qualified = active && version.attestation === "server_collected" && checksAttested && coverageQualifiedCompleteness({
    completeness: version.completeness,
    attestation: version.attestation,
    checks
  }) === "complete";
  const rowMarker = marker(row.reportVersionId);
  return {
    row,
    version,
    checks,
    active,
    qualified,
    marker: rowMarker,
    contribution: {
      handle: row.handle,
      aliases: [rowMarker, ...row.aliases],
      nodes: row.nodes,
      edges: row.edges,
      ...qualified ? { verdict: version.verdict } : {},
      reportVersionId: row.reportVersionId,
      provenanceState: "server_collected"
    }
  };
}
function incidentEdgeTypes(contribution, key, resolve) {
  const types = /* @__PURE__ */ new Set();
  for (const edge of contribution.edges) {
    if (resolve(edge.src) !== key && resolve(edge.dst) !== key) continue;
    const type = text(edge.type, 100);
    if (type) types.add(type);
  }
  return [...types].sort().slice(0, 20);
}
function safeTieStrength(key) {
  const strength = tieStrength(key);
  return strength === "hard" && !HARD_TIE_KEY.test(key) ? "medium" : strength;
}
function directTie(current, other, resolve) {
  const subjectNode = other.contribution.nodes.find((node) => node.subject === true);
  if (!subjectNode) return null;
  const key = resolve(subjectNode.key);
  const subjectEdgeTypes = incidentEdgeTypes(current, key, resolve);
  const otherEdgeTypes = incidentEdgeTypes(other.contribution, key, resolve);
  return {
    key,
    label: text(subjectNode.label, 300) ?? other.row.handle,
    type: text(subjectNode.type, 100) ?? "Subject",
    strength: safeTieStrength(key),
    subjectEdgeTypes,
    otherEdgeTypes
  };
}
function strongestTie(ties) {
  const rank = { hard: 3, medium: 2, weak: 1 };
  return [...ties].filter((tie) => tie.subjectEdgeTypes.length > 0 && tie.otherEdgeTypes.length > 0).sort((a, b) => rank[b.strength] - rank[a.strength] || a.key.localeCompare(b.key))[0] ?? null;
}
function incompleteScreen(note) {
  return {
    provider: "argus-graph",
    capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
    status: "incomplete",
    contributionCount: 0,
    qualifiedContributionCount: 0,
    sourceContentHash: semanticHash({ status: "incomplete", note }),
    line: note,
    connections: []
  };
}
function addGraphFinding(ctx, connection, tie, artifactHash3, capturedAt) {
  if (!connection.qualified || !connection.otherReportVersionId || connection.otherAttestation !== "server_collected" || connection.otherCompleteness !== "complete" || !connection.otherVerdict || !ADVERSE_VERDICTS2.has(connection.otherVerdict) || tie.strength === "weak" || tie.strength === "hard" && !HARD_TIE_KEY.test(tie.key) || !HASH.test(artifactHash3) || !tie.subjectEdgeTypes.length || !tie.otherEdgeTypes.length) return;
  const finding = {
    finding_type: "TrustGraphConnection",
    claim: `${ctx.evidence.profile.handle} is connected to ${connection.other} (${connection.otherVerdict}) through ${tie.label}. The link is bound to immutable report version ${connection.otherReportVersionId}.`,
    source_url: "",
    source_date: capturedAt,
    source_author: "argus-graph",
    verification_status: "Verified",
    independent_source_count: 1,
    polarity: -1,
    evidence_origin: "deterministic",
    artifact_verified: true,
    content_hash: artifactHash3,
    trust_graph: {
      tie_key: tie.key,
      tie_type: tie.type,
      tie_strength: tie.strength,
      subject_edge_types: tie.subjectEdgeTypes,
      other_edge_types: tie.otherEdgeTypes,
      other_report_version_id: connection.otherReportVersionId,
      other_attestation: "server_collected",
      other_completeness: "complete",
      other_verdict: connection.otherVerdict
    }
  };
  ctx.evidence.findings.push(finding);
}
async function collectTrustGraph(ctx, current) {
  const c = credentials();
  const organizationId = ctx.organizationId?.trim().toLowerCase() ?? "";
  if (!organizationId || !UUID.test(organizationId) || !c) {
    const note = !organizationId || !UUID.test(organizationId) ? "Trust-graph reconciliation requires a valid authenticated organization identifier." : "Trust-graph storage is not configured.";
    ctx.evidence.trustGraphScreen = incompleteScreen(note);
    ctx.recordCheck?.({
      id: "trust-graph-connections",
      status: "unavailable",
      note,
      provider: "argus-graph"
    });
    ctx.emit({ phase: "Network", label: "Trust graph unavailable", detail: note, source: "argus-graph", tone: "warn" });
    return { state: "partial", detail: note };
  }
  try {
    const rawRows = await readExactRows(c, "graph_contributions", {
      select: "handle,aliases,nodes,edges,report_version_id,provenance_state",
      organization_id: `eq.${organizationId}`,
      provenance_state: "eq.server_collected",
      report_version_id: "not.is.null",
      order: "updated_at.desc"
    });
    if (rawRows.length > GRAPH_LIMIT) throw new Error("authoritative graph read exceeded its exact row limit");
    const stored = parseGraphRows(rawRows);
    const ids = stored.map((row) => row.reportVersionId);
    let versions = /* @__PURE__ */ new Map();
    let checks = /* @__PURE__ */ new Map();
    let activeVersions = /* @__PURE__ */ new Set();
    if (ids.length) {
      const [versionResult, checkResult, activeResult] = await Promise.allSettled([
        readVersions(c, organizationId, ids),
        readChecks(c, organizationId, ids),
        readActiveVersionIds(c, organizationId, ids)
      ]);
      if (versionResult.status === "rejected") throw versionResult.reason;
      if (checkResult.status === "rejected") throw checkResult.reason;
      if (activeResult.status === "rejected") throw activeResult.reason;
      versions = versionResult.value;
      checks = checkResult.value;
      activeVersions = activeResult.value;
    }
    const qualified = stored.flatMap((row) => {
      const version = versions.get(row.reportVersionId);
      return version ? [qualification(
        row,
        version,
        checks.get(row.reportVersionId) ?? [],
        activeVersions.has(row.reportVersionId)
      )] : [];
    });
    const initialResolver = buildAliasResolver([...qualified.map((item) => item.contribution), current]);
    const currentId = initialResolver(current.handle);
    const others = qualified.filter((item) => initialResolver(item.contribution.handle) !== currentId);
    const contributions = [...others.map((item) => item.contribution), current];
    const resolve = buildAliasResolver(contributions);
    const byMarker = new Map(others.map((item) => [item.marker, item]));
    const rawConnections = subjectConnections(current.handle, contributions, Math.max(1, others.length));
    const connections = [];
    for (const connection of rawConnections) {
      const other = byMarker.get(connection.other);
      if (!other) throw new Error("trust-graph connection could not be bound to one exact report version");
      const ties = connection.ties.map((tie) => ({
        key: tie.key,
        label: tie.label,
        type: tie.type,
        strength: safeTieStrength(tie.key),
        subjectEdgeTypes: incidentEdgeTypes(current, tie.key, resolve),
        otherEdgeTypes: incidentEdgeTypes(other.contribution, tie.key, resolve)
      }));
      if (connection.direct && !ties.some((tie) => tie.key === resolve(other.row.handle))) {
        const direct = directTie(current, other, resolve);
        if (direct) ties.push(direct);
      }
      const frozen = {
        other: other.row.handle,
        otherReportVersionId: other.row.reportVersionId,
        otherAttestation: other.version.attestation,
        otherCompleteness: other.version.completeness,
        ...other.qualified ? { otherVerdict: other.version.verdict } : {},
        qualified: other.qualified,
        direct: connection.direct,
        ties: ties.sort((a, b) => a.key.localeCompare(b.key))
      };
      connections.push(frozen);
    }
    connections.sort((a, b) => (a.otherReportVersionId ?? "").localeCompare(b.otherReportVersionId ?? "") || a.other.localeCompare(b.other));
    const capturedAt = (/* @__PURE__ */ new Date()).toISOString();
    const artifactHash3 = semanticHash({
      organizationId,
      subject: semanticContribution(current),
      contributions: qualified.map((item) => ({
        graph: semanticContribution(item.contribution),
        reportVersionId: item.row.reportVersionId,
        version: item.version,
        checks: [...item.checks].sort((a, b) => JSON.stringify(stableValue(a)).localeCompare(JSON.stringify(stableValue(b)))),
        active: item.active,
        qualified: item.qualified
      })).sort((a, b) => a.reportVersionId.localeCompare(b.reportVersionId)),
      connections
    });
    const connectedUnqualified = connections.filter((connection) => !connection.qualified);
    const adverse = connections.filter((connection) => connection.qualified && connection.otherVerdict && ADVERSE_VERDICTS2.has(connection.otherVerdict));
    const hasHardRisk = adverse.some((connection) => {
      const tie = strongestTie(connection.ties);
      return tie?.strength === "hard" && HARD_TIE_KEY.test(tie.key);
    });
    const status = connectedUnqualified.length ? "incomplete" : adverse.length ? "risk" : "clear";
    const line = connectedUnqualified.length ? `${connectedUnqualified.length} graph connection${connectedUnqualified.length === 1 ? "" : "s"} could not be qualified because the linked immutable report is not the active case projection, or is stale, partial, or incompletely attested.` : adverse.length ? `${adverse.length} exact, coverage-qualified connection${adverse.length === 1 ? "" : "s"} lead to prior FAIL/AVOID reports. Review the frozen ties before relying on the score.` : connections.length ? `${connections.length} exact graph connection${connections.length === 1 ? "" : "s"} were reconciled; none lead to a coverage-qualified FAIL/AVOID report.` : "No connection to a prior authoritative ARGUS report was found in the organization graph.";
    const screen = {
      provider: "argus-graph",
      capturedAt,
      status,
      contributionCount: others.length,
      qualifiedContributionCount: others.filter((item) => item.qualified).length,
      sourceContentHash: artifactHash3,
      ...adverse.length ? { severity: hasHardRisk ? "avoid" : "caution" } : {},
      line,
      connections
    };
    ctx.evidence.trustGraphScreen = screen;
    ctx.evidence.sourceArtifacts.push({
      kind: "trust_graph",
      provider: "argus-graph",
      title: "Organization trust-graph reconciliation",
      capturedAt,
      contentHash: artifactHash3,
      sourceContentHash: artifactHash3,
      excerpt: line,
      match: status === "risk" ? "risk_signal" : status === "clear" ? "screened_clear" : "observed",
      ...status === "incomplete" ? { coverageState: "unavailable" } : {}
    });
    for (const connection of adverse) {
      const tie = strongestTie(connection.ties);
      if (tie) addGraphFinding(ctx, connection, tie, artifactHash3, capturedAt);
    }
    if (connectedUnqualified.length) {
      ctx.recordCheck?.({
        id: "trust-graph-connections",
        status: "unavailable",
        note: line,
        provider: "argus-graph",
        sourceCount: connections.length
      });
    } else if (adverse.length) {
      ctx.recordCheck?.({
        id: "trust-graph-connections",
        status: "finding",
        note: line,
        provider: "argus-graph",
        sourceCount: adverse.length
      });
    } else if (connections.length) {
      ctx.recordCheck?.({
        id: "trust-graph-connections",
        status: "confirmed",
        note: line,
        provider: "argus-graph",
        sourceCount: connections.length
      });
    } else {
      ctx.recordCheck?.({
        id: "trust-graph-connections",
        status: "checked-empty",
        note: line,
        provider: "argus-graph"
      });
    }
    ctx.emit({
      phase: "Network",
      label: status === "risk" ? "Qualified graph risk" : status === "incomplete" ? "Graph qualification incomplete" : "Trust graph reconciled",
      detail: line,
      source: "argus-graph",
      tone: status === "risk" ? hasHardRisk ? "bad" : "warn" : status === "incomplete" ? "warn" : "neutral"
    });
    return {
      state: status === "incomplete" ? "partial" : "executed",
      detail: `${others.length} authoritative contributions, ${connections.length} connected`
    };
  } catch (error) {
    const detail = `Trust-graph reconciliation failed closed: ${String(error)}`.slice(0, 500);
    ctx.evidence.trustGraphScreen = incompleteScreen(detail);
    ctx.recordCheck?.({
      id: "trust-graph-connections",
      status: "unavailable",
      note: detail,
      provider: "argus-graph"
    });
    ctx.emit({ phase: "Network", label: "Trust graph incomplete", detail, source: "argus-graph", tone: "warn" });
    return { state: "failed", detail };
  }
}

// server/adapters/portfolio.ts
import { createHash as createHash8 } from "node:crypto";
import { isIP as isIP3 } from "node:net";

// server/adapters/investorDiscovery.ts
var discoveryByEvidence = /* @__PURE__ */ new WeakMap();
var focusedPortfolioByEvidence = /* @__PURE__ */ new WeakMap();
var focusedFundScaleByEvidence = /* @__PURE__ */ new WeakMap();
var subjectName2 = (ctx) => ctx.evidence.profile.resolved_name || ctx.evidence.profile.display_name || ctx.handle;
var affiliationHints = (ctx) => ctx.evidence.ventures.slice(0, 12).map((venture) => `${venture.project_name} (${venture.role})`).join(", ");
var subjectContext = (ctx) => {
  const hints = affiliationHints(ctx);
  return `Audited subject: ${subjectName2(ctx)} (X ${ctx.handle})${ctx.evidence.profile.website ? `, official website ${ctx.evidence.profile.website}` : ""}. Official X bio: ${ctx.evidence.profile.bio || "not available"}.${hints ? ` Affiliation leads to investigate without assuming: ${hints}.` : ""}`;
};
var normalizedHandle = (ctx) => ctx.handle.replace(/^@/, "").toLowerCase();
function discoverInvestorEvidenceText(ctx) {
  if (!env("XAI_API_KEY")) return Promise.resolve(null);
  const existing = discoveryByEvidence.get(ctx.evidence);
  if (existing) return existing;
  const system = 'You discover public investment and fund-scale evidence for a forensic due-diligence collector. Use live web and X search only. For investments, find a bounded representative set disclosed by this exact fund, VC, or angel. For fund scale, find disclosed USD fund closes, first closes, fund vehicle sizes, or dated assets under management for the exact manager or a fund the person currently works for. Prefer the verified manager website, regulatory filings, project financing announcements for investment relationships, or reputable independent editorial reporting. Every candidate must include an exact public source URL. URLs and all model fields are leads only and will be fetched and re-derived. Never use model memory alone. Never infer an investment from a follow, employment, token holding, or company-name match. Never treat a portfolio company round, valuation, TVL, dry powder, deployed capital, target raise, or proposed hard cap as fund scale. Distinguish a personal investment from the portfolio or scale of a fund the person works for. If a source names the fund, attribute it to the affiliated fund and never rewrite it as personal capital. Return only compact JSON with both arrays: {"investments":[{"project":"","investor_entity":"person or fund actually named by the source","investor_x_handle":"@...","attribution":"direct_subject|affiliated_fund","relationship":"invested|backed|led round|incubated","stage":"","year":"","project_x_handle":"@...","project_domain":"example.com","ticker":"$...","contract":"","chain":"","sources":[{"url":"https://...","title":""}]}],"fund_scale":[{"fund_name":"manager or fund entity","fund_vehicle":"named vehicle if stated","fund_x_handle":"@...","attribution":"direct_subject|affiliated_fund","metric_hint":"aum|fund_vehicle|first_close|final_close","amount_hint_usd":0,"sources":[{"url":"https://...","title":""}]}]}. Return at most 10 investment candidates and 6 fund-scale candidates. Return empty arrays when none are found.';
  const user = subjectContext(ctx) + " Find source-linked direct investments, affiliated-fund investments, and source-linked fund-scale claims while keeping every attribution separate.";
  const pending = grokSearch(system, user, {
    maxToolCalls: 14,
    cacheKey: `investor-core:v3:${normalizedHandle(ctx)}`
  });
  discoveryByEvidence.set(ctx.evidence, pending);
  return pending;
}
function discoverFocusedPortfolioEvidenceText(ctx) {
  if (!env("XAI_API_KEY")) return Promise.resolve(null);
  const existing = focusedPortfolioByEvidence.get(ctx.evidence);
  if (existing) return existing;
  const system = `You discover public investment relationships for a forensic due-diligence collector. Use live web and X search only. Find a bounded, representative set of disclosed investments made by this exact fund, VC, or angel. Prefer the fund's official portfolio page, a project or company financing announcement, a regulatory filing, or reputable independent editorial reporting. Every candidate must include at least one exact public source URL; prefer two independent URLs. URLs and all model fields are leads only and will be fetched and independently re-derived. Never use model memory alone. Never infer an investment from a follow, employment, token holding, trading activity, or company-name match. Distinguish a personal investment from the portfolio of a fund the person works for. If a source names the fund, set investor_entity to that fund, attribution to affiliated_fund, and never rewrite it as the person's direct investment. Return only compact JSON: {"investments":[{"project":"","investor_entity":"person or fund actually named by the source","investor_x_handle":"@...","attribution":"direct_subject|affiliated_fund","relationship":"invested|backed|led round|incubated","stage":"","year":"","project_x_handle":"@...","project_domain":"example.com","ticker":"$...","contract":"","chain":"","sources":[{"url":"https://...","title":""}]}]}. Return at most 10 strong source-linked candidates. Return an empty list when none are found.`;
  const user = subjectContext(ctx) + " Find source-linked direct investments and, separately, investments made by a fund this subject is currently and publicly affiliated with. Keep every attribution separate.";
  const pending = grokSearch(system, user, {
    maxToolCalls: 12,
    cacheKey: `investor-portfolio-focused:v1:${normalizedHandle(ctx)}`
  });
  focusedPortfolioByEvidence.set(ctx.evidence, pending);
  return pending;
}
function discoverFocusedFundScaleEvidenceText(ctx) {
  if (!env("XAI_API_KEY")) return Promise.resolve(null);
  const existing = focusedFundScaleByEvidence.get(ctx.evidence);
  if (existing) return existing;
  const system = `You discover public fund-scale evidence for a forensic due-diligence collector. Use live web and X search only. Find disclosed USD fund closes, first closes, completed fund vehicle sizes, or dated assets under management for this exact manager or a fund the person currently works for. Prefer the verified manager website, regulatory filings, or reputable independent editorial reporting. Every candidate must include an exact public source URL; prefer two independent URLs. URLs and all model fields are leads only and will be fetched and independently re-derived. Never use model memory alone. Never treat a portfolio-company financing round, valuation, TVL, revenue, dry powder, deployed or invested capital, target raise, or proposed hard cap as fund scale. Accept USD claims only. Distinguish personal capital from an affiliated fund. If a source names the fund, set attribution to affiliated_fund and never rewrite its capital as the person's own. Return only compact JSON: {"fund_scale":[{"fund_name":"manager or fund entity","fund_vehicle":"named vehicle if stated","fund_x_handle":"@...","attribution":"direct_subject|affiliated_fund","metric_hint":"aum|fund_vehicle|first_close|final_close","amount_hint_usd":0,"sources":[{"url":"https://...","title":""}]}]}. Return at most 6 strong source-linked candidates. Return an empty list when none are found.`;
  const user = subjectContext(ctx) + " Find source-linked scale claims for the exact subject and, separately, any fund the subject is currently and publicly affiliated with. Keep every attribution separate.";
  const pending = grokSearch(system, user, {
    maxToolCalls: 12,
    cacheKey: `investor-fund-scale-focused:v1:${normalizedHandle(ctx)}`
  });
  focusedFundScaleByEvidence.set(ctx.evidence, pending);
  return pending;
}

// server/adapters/portfolio.ts
var MAX_CANDIDATES = 10;
var MAX_SOURCES_PER_CANDIDATE = 3;
var PRIMARY_HOSTS = [
  "sec.gov",
  "fca.org.uk",
  "gov.uk",
  "companieshouse.gov.uk",
  "asic.gov.au",
  "sedarplus.ca"
];
var PRESS_HOSTS = [
  "reuters.com",
  "bloomberg.com",
  "ft.com",
  "wsj.com",
  "techcrunch.com",
  "fortune.com",
  "coindesk.com",
  "theblock.co",
  "decrypt.co",
  "blockworks.co",
  "venturebeat.com"
];
var PROFILE_AFFILIATION_MAX_AGE_MS = 24 * 60 * 60 * 1e3;
var PROFILE_AFFILIATION_CLOCK_SKEW_MS = 5 * 60 * 1e3;
var SENSITIVE_URL_PARAM4 = /^(?:(?:x[-_]?(?:amz|goog)|x[-_](?:oss|cos))[-_].+|x[-_]ms[-_](?:signature|token|credential)|access[_-]?token|api[_-]?key|key|token|signature|sig|auth|credential|credentials|security[_-]?token|session[_-]?token|awsaccesskeyid|googleaccessid|key[_-]?pair[_-]?id|policy|cf[_-]?access[_-]?token)$/i;
var MIN_VERIFIED_RELATIONSHIPS_FOR_PARTIAL_OUTCOME = 3;
var MIN_VERIFIED_DISPOSITION_PERCENT = 75;
function hasRecordedPartialPortfolioOutcome(verified, incomplete) {
  if (verified < MIN_VERIFIED_RELATIONSHIPS_FOR_PARTIAL_OUTCOME || incomplete <= 0) return false;
  return verified * 100 >= (verified + incomplete) * MIN_VERIFIED_DISPOSITION_PERCENT;
}
var clean2 = (value, max) => typeof value === "string" && value.trim() ? value.trim().slice(0, max) : void 0;
var hostMatches2 = (host, expected) => {
  const left = host.replace(/^www\./i, "").toLowerCase();
  const right = expected.replace(/^www\./i, "").toLowerCase();
  return left === right || left.endsWith(`.${right}`);
};
var listedHost2 = (host, list) => list.some((candidate) => hostMatches2(host, candidate));
function domainFromWebsite(value) {
  const scope = canonicalOfficialWebsite(value);
  return scope && isCredibleOfficialDomain(scope.domain) ? scope.domain : void 0;
}
function safeCandidateUrl2(value) {
  if (typeof value !== "string" || value.length > 2e3) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (url.protocol !== "https:" && url.protocol !== "http:" || url.username || url.password || !host || isIP3(host) || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return null;
    if ([...url.searchParams.keys()].some((key) => SENSITIVE_URL_PARAM4.test(key))) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}
function relationshipValue(value) {
  void value;
  return "invested_in";
}
function parsePortfolioCandidates(text2) {
  const match = text2.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let payload;
  try {
    payload = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const rows = payload.investments;
  if (!Array.isArray(rows)) return null;
  const leads = [];
  const seen = /* @__PURE__ */ new Set();
  for (const raw of rows) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const row = raw;
    const projectName2 = clean2(row.project, 120);
    if (!projectName2) continue;
    const sources = [];
    const rawSources = Array.isArray(row.sources) ? row.sources : [];
    for (const candidate of rawSources) {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
      const source2 = candidate;
      const url = safeCandidateUrl2(source2.url);
      if (!url) continue;
      sources.push({ url, ...clean2(source2.title, 180) ? { title: clean2(source2.title, 180) } : {} });
    }
    const singularUrl = safeCandidateUrl2(row.source_url);
    if (singularUrl) sources.push({
      url: singularUrl,
      ...clean2(row.source_title, 180) ? { title: clean2(row.source_title, 180) } : {}
    });
    const uniqueSources = sources.filter(
      (source2, index) => sources.findIndex((candidate) => candidate.url === source2.url) === index
    ).slice(0, MAX_SOURCES_PER_CANDIDATE);
    const investorEntityName = clean2(row.investor_entity, 120);
    const attribution = row.attribution === "affiliated_fund" ? "affiliated_fund" : row.attribution === "direct_subject" ? "direct_subject" : void 0;
    const key = `${investorEntityName?.toLowerCase() ?? ""}::${attribution ?? ""}::${projectName2.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const projectHandle = clean2(row.project_x_handle ?? row.x_handle, 40)?.replace(/^@/, "");
    const projectDomain = domainFromWebsite(clean2(row.project_domain ?? row.domain, 300));
    const investorHandle = clean2(row.investor_x_handle, 40)?.replace(/^@/, "");
    const contract = clean2(row.contract, 90);
    leads.push({
      projectName: projectName2,
      ...projectHandle && /^[A-Za-z0-9_]{2,30}$/.test(projectHandle) ? { projectHandle: `@${projectHandle}` } : {},
      ...projectDomain ? { projectDomain } : {},
      ...investorEntityName ? { investorEntityName } : {},
      ...investorHandle && /^[A-Za-z0-9_]{2,30}$/.test(investorHandle) ? { investorEntityHandle: `@${investorHandle}` } : {},
      ...attribution ? { attribution } : {},
      relationship: relationshipValue(row.relationship),
      ...clean2(row.stage, 60) ? { stage: clean2(row.stage, 60) } : {},
      ...clean2(row.year, 20) ? { year: clean2(row.year, 20) } : {},
      ...clean2(row.ticker, 20) ? { ticker: clean2(row.ticker, 20) } : {},
      ...contract && /^(?:0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/.test(contract) ? { contract } : {},
      ...clean2(row.chain, 30) ? { chain: clean2(row.chain, 30)?.toLowerCase() } : {},
      sources: uniqueSources,
      evidence_origin: "model_lead",
      artifact_verified: false,
      provider: "grok"
    });
    if (leads.length >= MAX_CANDIDATES) break;
  }
  return leads;
}
async function discoverPortfolioCandidates(ctx) {
  if (!env("XAI_API_KEY")) return null;
  const text2 = await discoverInvestorEvidenceText(ctx);
  if (!text2) return null;
  const shared = parsePortfolioCandidates(text2);
  if (!shared) return null;
  const sourceLinked = shared.filter((lead) => lead.sources.length > 0);
  if (sourceLinked.length > 0) return shared;
  const focusedText = await discoverFocusedPortfolioEvidenceText(ctx);
  return focusedText ? parsePortfolioCandidates(focusedText) : null;
}
var defaultProjectDomainResolver = async (lead, lookupProfile = getProfile2) => {
  if (!lead.projectHandle || lookupProfile === getProfile2 && !env("TWITTERAPI_KEY")) return void 0;
  const profile = await lookupProfile(lead.projectHandle);
  if (!profile?.name || !entityNamesMatch(profile.name, lead.projectName)) return void 0;
  return domainFromWebsite(profile.website);
};
function likelyIndividualSubject(ctx) {
  if (ctx.evidence.profile.resolved_name?.trim()) return true;
  const display = ctx.evidence.profile.display_name.trim();
  const bio = normalized(ctx.evidence.profile.bio);
  return display.split(/\s+/).filter(Boolean).length >= 2 && /\b(?:i am|i m|my |(?:founder|co founder|partner|principal|engineer|researcher|investor|cto)\s*(?:at|with|@))/.test(bio);
}
var canonicalSubjectHandle = (value) => {
  const bare = value.trim().replace(/^@/, "");
  return /^[A-Za-z0-9_]{1,30}$/.test(bare) ? `@${bare.toLowerCase()}` : null;
};
var attributionProofHash = (value) => createHash8("sha256").update(JSON.stringify(value)).digest("hex");
function sourcePathBindsSubjectHandle(sourceUrl, subjectHandle) {
  try {
    const tokens = decodeURIComponent(new URL(sourceUrl).pathname).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean);
    return tokens.includes(subjectHandle.replace(/^@/, "").toLowerCase());
  } catch {
    return false;
  }
}
function providerProfileAffiliationProof(ctx, now) {
  const profile = ctx.evidence.profile;
  const subjectHandle = canonicalSubjectHandle(ctx.handle);
  const captured = typeof profile.profile_captured_at === "string" ? new Date(profile.profile_captured_at) : null;
  if (!subjectHandle || profile.profile_collection_state !== "resolved" || profile.profile_provider !== "twitterapi" || !captured || !Number.isFinite(captured.getTime()) || !Number.isFinite(now.getTime()) || captured.getTime() > now.getTime() + PROFILE_AFFILIATION_CLOCK_SKEW_MS || now.getTime() - captured.getTime() > PROFILE_AFFILIATION_MAX_AGE_MS) return null;
  const attributionCapturedAt = captured.toISOString();
  const attributionSourceUrl = `https://x.com/${subjectHandle.slice(1)}`;
  return {
    subjectHandle,
    attributionSourceUrl,
    attributionSourceContentHash: attributionProofHash({
      kind: "provider_profile",
      provider: profile.profile_provider,
      subjectHandle,
      displayName: profile.display_name,
      resolvedName: profile.resolved_name ?? null,
      bio: profile.bio,
      capturedAt: attributionCapturedAt
    }),
    attributionCapturedAt,
    attributionSourceKind: "provider_profile"
  };
}
function ventureAffiliationEnded(venture) {
  const description = normalized([
    venture.role,
    venture.period,
    venture.notes ?? ""
  ].join(" "));
  if (/\b(?:former|formerly|previously|ex|no longer|left|departed|retired|until)\b/.test(description)) return true;
  return /(?:19|20)\d{2}\s*(?:[-–\u2014]|to)\s*(?:19|20)\d{2}/i.test(venture.period) && !/\b(?:present|current|ongoing|now)\b/i.test(venture.period);
}
function verifiedVentureAffiliationProof(ctx, venture, now) {
  const subjectHandle = canonicalSubjectHandle(ctx.handle);
  const sourceUrl = safeCandidateUrl2(venture.evidence_url);
  const provider = clean2(venture.provider, 100);
  if (!subjectHandle || !sourceUrl || !sourcePathBindsSubjectHandle(sourceUrl, subjectHandle) || !provider || !Number.isFinite(now.getTime()) || venture.artifact_verified !== true || venture.evidence_origin !== "deterministic" && venture.evidence_origin !== "human_verified" || ventureAffiliationEnded(venture)) return null;
  const attributionCapturedAt = now.toISOString();
  return {
    subjectHandle,
    attributionSourceUrl: sourceUrl,
    attributionSourceContentHash: attributionProofHash({
      kind: "verified_venture",
      provider,
      subjectHandle,
      projectName: venture.project_name,
      projectHandle: venture.x_handle ?? null,
      projectDomain: domainFromWebsite(venture.domain) ?? null,
      role: venture.role,
      period: venture.period,
      outcome: venture.outcome,
      evidenceUrl: sourceUrl,
      notes: venture.notes ?? null,
      capturedAt: attributionCapturedAt
    }),
    attributionCapturedAt,
    attributionSourceKind: "verified_venture"
  };
}
function portfolioEntityForLead(ctx, lead, now = /* @__PURE__ */ new Date()) {
  const directName = ctx.evidence.profile.resolved_name || ctx.evidence.profile.display_name || ctx.handle;
  const subjectHandle = canonicalSubjectHandle(ctx.handle) ?? ctx.handle;
  const directAliases = [directName, ctx.evidence.profile.display_name, ctx.handle.replace(/^@/, "")].filter((value) => Boolean(value?.trim()));
  const requested = lead.investorEntityName?.trim();
  const requestedHandle = lead.investorEntityHandle?.replace(/^@/, "").toLowerCase();
  const matches = (values) => values.some((value) => {
    if (!value || !requested) return false;
    const left = compact(value);
    const right = compact(requested);
    return left === right || left.length >= 5 && right.length >= 5 && (left.includes(right) || right.includes(left));
  });
  if (!requested || matches(directAliases) || requestedHandle === ctx.handle.replace(/^@/, "").toLowerCase()) {
    const directDomainScope = likelyIndividualSubject(ctx) ? null : canonicalOfficialWebsite(ctx.evidence.profile.website);
    return {
      name: directName,
      aliases: directAliases,
      handle: ctx.handle,
      handleTrusted: true,
      // A person's X website frequently points to their employer fund. Treating
      // that fund portfolio as the person's first-party page would manufacture
      // personal investments. Personal attribution therefore requires the
      // person's name in the fetched source unless an explicit personal-domain
      // verifier is added later.
      domain: directDomainScope?.domain,
      domainScope: directDomainScope?.canonicalUrl,
      attribution: "direct_subject",
      entityType: likelyIndividualSubject(ctx) ? "person" : "organization",
      subjectHandle
    };
  }
  const bio = normalized(ctx.evidence.profile.bio);
  const profileProof = providerProfileAffiliationProof(ctx, now);
  if (lead.attribution === "affiliated_fund" && profileProof && bioHasCurrentAffiliation(bio, requested, requestedHandle)) {
    const handleTrusted = Boolean(requestedHandle && bioHasCurrentHandleAffiliation(bio, requestedHandle));
    return {
      name: requested,
      aliases: [requested],
      handle: lead.investorEntityHandle,
      handleTrusted,
      attribution: "affiliated_fund",
      entityType: "organization",
      ...profileProof
    };
  }
  const verifiedAffiliation = ctx.evidence.ventures.map((venture) => ({ venture, proof: verifiedVentureAffiliationProof(ctx, venture, now) })).find(({ venture, proof }) => Boolean(proof) && (matches([venture.project_name]) || requestedHandle && venture.x_handle?.replace(/^@/, "").toLowerCase() === requestedHandle));
  if (verifiedAffiliation?.proof) {
    const { venture, proof } = verifiedAffiliation;
    return {
      name: venture.project_name,
      aliases: [venture.project_name, requested].filter(Boolean),
      handle: venture.x_handle || lead.investorEntityHandle,
      handleTrusted: Boolean(venture.x_handle),
      domain: domainFromWebsite(venture.domain),
      attribution: "affiliated_fund",
      entityType: "organization",
      ...proof
    };
  }
  return null;
}
var defaultInvestorDomainResolver = async (lead, entity, lookupProfile = getProfile2, now = /* @__PURE__ */ new Date()) => {
  if (entity.domainProof) return entity.domainProof;
  if (entity.domain) return entity.domain;
  if (entity.entityType === "person") return void 0;
  if (entity.attribution === "affiliated_fund" && !entity.handleTrusted) return void 0;
  const handle = entity.handle || lead.investorEntityHandle;
  if (!handle || lookupProfile === getProfile2 && !env("TWITTERAPI_KEY")) return void 0;
  const profile = await lookupProfile(handle);
  if (!profile?.name || !entityNamesMatch(profile.name, entity.name)) return void 0;
  const websiteScope = canonicalOfficialWebsite(profile.website);
  const domain = websiteScope?.domain;
  const profileHandle = canonicalSubjectHandle(profile.handle);
  const profileWebsite = websiteScope?.canonicalUrl;
  if (!domain || !profileHandle || !profileWebsite || !Number.isFinite(now.getTime())) return void 0;
  const capturedAt = now.toISOString();
  const sourceUrl = `https://x.com/${profileHandle.slice(1)}`;
  return {
    domain,
    sourceUrl,
    sourceContentHash: attributionProofHash({
      kind: "provider_profile_domain",
      provider: "twitterapi",
      handle: profileHandle,
      name: profile.name,
      website: profileWebsite,
      domain,
      capturedAt
    }),
    capturedAt,
    sourceKind: "provider_profile",
    profileName: profile.name,
    profileWebsite
  };
};
function sourceClass(sourceUrl, investorDomain, investorDomainScope, projectDomain, attribution = "direct_subject") {
  let host;
  try {
    const url = new URL(sourceUrl);
    if (url.protocol !== "https:" || url.username || url.password) return "other_public";
    host = url.hostname;
  } catch {
    return "other_public";
  }
  if (listedHost2(host, PRIMARY_HOSTS)) return "public_primary";
  if (listedHost2(host, PRESS_HOSTS)) return "independent_press";
  if (investorDomain && hostMatches2(host, investorDomain) && (!investorDomainScope || sourceMatchesOfficialWebsiteScope(sourceUrl, investorDomainScope))) {
    return attribution === "direct_subject" ? "first_party_subject" : "first_party_investor";
  }
  if (projectDomain && hostMatches2(host, projectDomain)) return "first_party_project";
  return "other_public";
}
function htmlToVisibleText(raw) {
  return raw.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<\/?(?:article|aside|blockquote|br|dd|div|dl|dt|figcaption|figure|footer|h[1-6]|header|li|main|nav|ol|p|section|table|tbody|td|th|thead|tr|ul)\b[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;|&#34;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/[\t\f\v ]+/g, " ").replace(/ *\n+ */g, "\n").trim();
}
var normalized = (value) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9@$._ -]+/g, " ").replace(/\s+/g, " ").trim();
var compact = (value) => normalized(value).replace(/[^a-z0-9]+/g, "");
var regexEscape3 = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
var AFFILIATION_ROLE2 = "(?:founding |general |managing |research )?(?:partner|principal|investor|researcher|research|engineer|developer|employee|advisor|adviser|cto|chief technology officer|team member|team|lead|director|gp)|(?:co founder|cofounder|founder|ceo|chief executive officer|cio|chief investment officer|portfolio manager|managing director)";
function entityWords(entity) {
  return normalized(entity.replace(/^@/, "")).split(/[^a-z0-9]+/).filter(Boolean);
}
function entityPattern(entity, global = false) {
  const words = entityWords(entity);
  if (!words.length || words.length === 1 && words[0].length < 2) return null;
  const phrase = words.map(regexEscape3).join("[^a-z0-9]+");
  return new RegExp(`(?:^|[^a-z0-9])(${phrase})(?=$|[^a-z0-9])`, global ? "gi" : "i");
}
function entitySpans(text2, entity) {
  const pattern = entityPattern(entity, true);
  if (!pattern) return [];
  const spans = [];
  for (const match of text2.matchAll(pattern)) {
    const phrase = match[1] ?? "";
    const start = (match.index ?? 0) + match[0].lastIndexOf(phrase);
    spans.push({ start, end: start + phrase.length });
  }
  return spans;
}
function containsEntity(text2, entity) {
  return entitySpans(normalized(text2), entity).length > 0;
}
function ambiguousSingleWord(entity) {
  const words = entityWords(entity);
  return words.length === 1 && words[0].length <= 4;
}
function containsProjectEntity(text2, project) {
  if (!ambiguousSingleWord(project)) return containsEntity(text2, project);
  const word = project.trim().replace(/^@/, "");
  return new RegExp(`(?:^|[^A-Za-z0-9])${regexEscape3(word)}(?=$|[^A-Za-z0-9])`).test(text2);
}
function explicitAmbiguousRelationship(text2, project) {
  const word = project.trim().replace(/^@/, "");
  const pattern = new RegExp(`(?:^|[^A-Za-z0-9])(${regexEscape3(word)})(?=$|[^A-Za-z0-9])`, "g");
  for (const match of text2.matchAll(pattern)) {
    const phrase = match[1] ?? "";
    const start = (match.index ?? 0) + match[0].lastIndexOf(phrase);
    const before = text2.slice(Math.max(0, start - 100), start).toLowerCase();
    const after = text2.slice(start + phrase.length, start + phrase.length + 100).toLowerCase();
    if (/(?:invested in|investment in|backed|portfolio includes|portfolio company[: -]|led (?:the )?round in)\s*$/.test(before)) return true;
    if (/^\s*(?:is|was|\u2014|-|:)\s*(?:an? )?(?:investment|portfolio company|backed company)\b/.test(after)) return true;
  }
  return false;
}
function entityNamesMatch(leftRaw, rightRaw) {
  const left = normalized(leftRaw);
  const right = normalized(rightRaw);
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  return shorter.length >= 5 && (longer.startsWith(`${shorter} `) || longer.endsWith(` ${shorter}`));
}
function bioHasCurrentAffiliation(bio, entity, handle) {
  const aliases = [entity, handle?.replace(/^@/, "")].filter((value) => Boolean(value));
  const role = `(?:${AFFILIATION_ROLE2})`;
  for (const alias of aliases) {
    for (const span of entitySpans(bio, alias)) {
      const before = bio.slice(Math.max(0, span.start - 100), span.start);
      const after = bio.slice(span.end, Math.min(bio.length, span.end + 70));
      const endedMarkers = [...before.matchAll(/\b(?:former|formerly|previously|ex|no longer|left|departed|retired)\b/gi)];
      const currentMarkers = [...before.matchAll(/\b(?:now|currently)\b/gi)];
      const lastEnded = endedMarkers.at(-1)?.index ?? -1;
      const lastCurrent = currentMarkers.at(-1)?.index ?? -1;
      const endedBefore = lastEnded >= 0 && lastCurrent < lastEnded;
      const endedAfter = /^[^.;|]{0,55}\b(?:no longer|left|departed|retired|until|through)\b/i.test(after);
      const negated = new RegExp(`\\b(?:not|never)\\s+(?:currently\\s+)?(?:an?\\s+)?(?:${AFFILIATION_ROLE2})\\b[^.;|]{0,35}$`, "i").test(before) || /\b(?:no\s+(?:current\s+)?affiliation|not\s+affiliated|never\s+(?:worked|working))\b[^.;|]{0,35}$/i.test(before) || /\b(?:not|never)(?:\s+an?)?\s*@?\s*$/i.test(before) && new RegExp(`^\\s*(?:${role})\\b`, "i").test(after);
      if (endedBefore || endedAfter || negated) continue;
      if (new RegExp(`${role}\\s+(?:at|with|@)\\s*(?:the\\s+)?$`, "i").test(before)) return true;
      if (/\b(?:work(?:ing|s)?|build(?:ing|s)?|research(?:ing|es)?)\s+(?:at|with|@)\s*(?:the\s+)?$/i.test(before)) return true;
      if (new RegExp(`^\\s*(?:${role})\\b`, "i").test(after)) return true;
    }
  }
  return false;
}
function bioHasCurrentHandleAffiliation(bio, handle) {
  const bare = handle.replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9_]{2,30}$/.test(bare)) return false;
  const role = `(?:${AFFILIATION_ROLE2})`;
  const pattern = new RegExp(`@${regexEscape3(bare)}(?=$|[^a-z0-9_])`, "gi");
  for (const match of bio.matchAll(pattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const before = bio.slice(Math.max(0, start - 100), start);
    const after = bio.slice(end, Math.min(bio.length, end + 70));
    const endedMarkers = [...before.matchAll(/\b(?:former|formerly|previously|ex|no longer|left|departed|retired)\b/gi)];
    const currentMarkers = [...before.matchAll(/\b(?:now|currently)\b/gi)];
    const lastEnded = endedMarkers.at(-1)?.index ?? -1;
    const lastCurrent = currentMarkers.at(-1)?.index ?? -1;
    if (lastEnded >= 0 && lastCurrent < lastEnded) continue;
    if (/^[^.;|]{0,55}\b(?:no longer|left|departed|retired|until|through)\b/i.test(after)) continue;
    if (new RegExp(`\\b(?:not|never)\\s+(?:currently\\s+)?(?:an?\\s+)?(?:${AFFILIATION_ROLE2})\\b[^.;|]{0,35}$`, "i").test(before) || /\b(?:no\s+(?:current\s+)?affiliation|not\s+affiliated|never\s+(?:worked|working))\b[^.;|]{0,35}$/i.test(before)) continue;
    if (/\b(?:not|never)(?:\s+an?)?\s*$/i.test(before) && new RegExp(`^\\s*(?:${role})\\b`, "i").test(after)) continue;
    if (new RegExp(`${role}\\s*(?:(?:at|with)\\s*)?$`, "i").test(before)) return true;
    if (/\b(?:work(?:ing|s)?|build(?:ing|s)?|research(?:ing|es)?)\s*(?:(?:at|with)\s*)?$/i.test(before)) return true;
    if (new RegExp(`^\\s*(?:${role})\\b`, "i").test(after)) return true;
  }
  return false;
}
var RELATION = /\b(?:invest(?:ed|ing|ment|ments|or|ors)?|back(?:ed|ing|er|ers)?|portfolio|funding|financing|capital raise|led (?:the )?round|participat(?:ed|ing) in (?:the )?round|seed round|pre seed|series [a-e]|strategic round|incubat(?:ed|or|ion))\b/i;
var NEGATED = /\b(?:did not|does not|do not|never|no)\s+(?:invest|back|participate)|\bnot\s+(?:an?\s+)?(?:investor|backer)|\bden(?:y|ies|ied)\s+(?:investing|the investment|backing)\b/i;
function supportsPortfolioRelationship(input) {
  const visible = htmlToVisibleText(input.document.text);
  if (!containsProjectEntity(visible, input.projectName)) return { supported: false };
  const segments = visible.split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9@])/).map((segment) => segment.trim()).filter((segment) => segment.length >= 3 && segment.length <= 1600);
  const projectSegments = segments.filter((segment) => containsProjectEntity(segment, input.projectName));
  const portfolioPath = /\/(?:portfolio|investments?|companies|backed)(?:\/|$)/i.test(new URL(input.document.url).pathname);
  const portfolioPage = portfolioPath || projectSegments.some((segment) => RELATION.test(segment)) || /\b(?:our )?(?:portfolio|investments)\b/i.test(visible.slice(0, 1200));
  if (input.sourceClass === "first_party_subject" || input.sourceClass === "first_party_investor") {
    const ambiguous = ambiguousSingleWord(input.projectName);
    const pathMentionsProject = new URL(input.document.url).pathname.split("/").some((part) => normalized(part) === normalized(input.projectName));
    const supportedSegment2 = projectSegments.find((segment) => !NEGATED.test(segment) && (!ambiguous || pathMentionsProject || explicitAmbiguousRelationship(segment, input.projectName)));
    if (!portfolioPage || !supportedSegment2) return { supported: false };
    return { supported: true, excerpt: supportedSegment2.slice(0, 700) };
  }
  const supportedSegment = projectSegments.find((segment) => input.subjectAliases.some((alias) => containsEntity(segment, alias)) && RELATION.test(segment) && !NEGATED.test(segment));
  if (!supportedSegment) return { supported: false };
  return { supported: true, excerpt: supportedSegment.slice(0, 700) };
}
function registrableApprox2(host) {
  const parts = host.replace(/^www\./i, "").toLowerCase().split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const twoLevelSuffix = /* @__PURE__ */ new Set(["co.uk", "org.uk", "com.au", "com.br", "co.nz", "co.jp"]);
  const tail = parts.slice(-2).join(".");
  return twoLevelSuffix.has(tail) ? parts.slice(-3).join(".") : tail;
}
function artifactHash(artifact) {
  return createHash8("sha256").update(JSON.stringify(artifact)).digest("hex");
}
async function collectPortfolioRelationships(ctx, dependencies = {}) {
  const discover = dependencies.discover ?? discoverPortfolioCandidates;
  const fetchSource = dependencies.fetchSource ?? fetchPublicText;
  const lookupProfile = dependencies.lookupProfile ?? getProfile2;
  const now = dependencies.now?.() ?? /* @__PURE__ */ new Date();
  const resolveProjectDomain = dependencies.resolveProjectDomain ?? ((lead) => defaultProjectDomainResolver(lead, lookupProfile));
  const resolveInvestorDomain = dependencies.resolveInvestorDomain ?? ((lead, entity) => defaultInvestorDomainResolver(lead, entity, lookupProfile, now));
  const investorDomainByEntity = /* @__PURE__ */ new Map();
  const sourceByUrl = /* @__PURE__ */ new Map();
  const fetchSourceOnce = (url) => {
    const key = new URL(url).toString();
    const existing = sourceByUrl.get(key);
    if (existing) return existing;
    const pending = fetchSource(url).then((result) => {
      recordCall(
        "portfolio-web",
        "source-fetch",
        0,
        result.status === "ok" ? "source_fetched" : result.reason,
        result.status === "ok" ? "succeeded" : "failed"
      );
      return result;
    });
    sourceByUrl.set(key, pending);
    return pending;
  };
  const resolveInvestorDomainOnce = (lead, entity) => {
    const key = `${entity.attribution}::${compact(entity.name)}::${entity.handle ? canonicalSubjectHandle(entity.handle) ?? "" : ""}`;
    const existing = investorDomainByEntity.get(key);
    if (existing) return existing;
    const pending = resolveInvestorDomain(lead, entity).catch(() => entity.domain);
    investorDomainByEntity.set(key, pending);
    return pending;
  };
  if (!dependencies.discover && !env("XAI_API_KEY")) {
    ctx.recordCheck?.({
      id: "vc-portfolio-track-record",
      status: "unavailable",
      note: "Source-linked portfolio discovery is not configured; Crunchbase is optional and is not required",
      provider: "portfolio-web"
    });
    return { state: "skipped", detail: "source-linked portfolio discovery is not configured" };
  }
  ctx.emit({
    phase: "Investor",
    label: "Portfolio evidence",
    detail: "Discovering cited investments, then fetching each source and verifying the relationship before scoring\u2026",
    source: "grok \xB7 first-party pages \xB7 primary sources \xB7 independent press",
    tone: "neutral"
  });
  const leads = await discover(ctx);
  if (!leads) {
    ctx.recordCheck?.({
      id: "vc-portfolio-track-record",
      status: "unavailable",
      note: "Source-linked portfolio discovery did not return a complete response",
      provider: "portfolio-web"
    });
    return { state: "failed", detail: "portfolio discovery failed" };
  }
  ctx.evidence.portfolioLeads = leads.slice(0, MAX_CANDIDATES).map((lead) => ({ ...lead, sources: lead.sources.map((source2) => ({ ...source2 })) }));
  if (!leads.length) {
    ctx.recordCheck?.({
      id: "vc-portfolio-track-record",
      status: "unavailable",
      note: "Discovery returned no source-linked candidates, but a model search is not an exhaustive portfolio screen; no authoritative portfolio surface was inspected",
      provider: "portfolio-web"
    });
    ctx.emit({ phase: "Investor", label: "Portfolio coverage unavailable", detail: "Discovery returned no cited candidates; ARGUS did not treat model silence as evidence that no portfolio exists.", source: "portfolio-web", tone: "warn" });
    return { state: "partial", detail: "0 source-linked candidates \xB7 no authoritative surface inspected" };
  }
  const entityByLead = new Map(
    leads.slice(0, MAX_CANDIDATES).map((lead) => [lead, portfolioEntityForLead(ctx, lead, now)])
  );
  const unattributedCandidates = [...entityByLead.values()].filter((entity) => !entity).length;
  const sourceLessCandidates = [...entityByLead.entries()].filter(([lead, entity]) => Boolean(entity) && lead.sources.length === 0).length;
  const inspections = (await Promise.all(leads.slice(0, MAX_CANDIDATES).map(async (lead) => {
    const entity = entityByLead.get(lead) ?? null;
    if (!entity) return [];
    const resolvedInvestorDomain = await resolveInvestorDomainOnce(lead, entity);
    const resolvedDomain = typeof resolvedInvestorDomain === "string" ? resolvedInvestorDomain : resolvedInvestorDomain?.domain;
    const officialInvestorDomain = domainFromWebsite(resolvedDomain);
    const investorDomainProof = typeof resolvedInvestorDomain === "object" && officialInvestorDomain === resolvedInvestorDomain.domain ? { ...resolvedInvestorDomain, domain: officialInvestorDomain } : void 0;
    const officialInvestorDomainScope = investorDomainProof?.profileWebsite ?? entity.domainScope;
    const investorAliases = [
      ...entity.aliases,
      entity.handle && (entity.handleTrusted || officialInvestorDomain) ? entity.handle.replace(/^@/, "") : void 0
    ].filter((value) => Boolean(value?.trim()));
    const candidateHosts = lead.sources.flatMap((source2) => {
      try {
        return [new URL(source2.url).hostname.replace(/^www\./i, "").toLowerCase()];
      } catch {
        return [];
      }
    });
    const needsProjectDomain = candidateHosts.some(
      (host) => !(officialInvestorDomain && hostMatches2(host, officialInvestorDomain)) && !listedHost2(host, PRIMARY_HOSTS) && !listedHost2(host, PRESS_HOSTS)
    );
    const officialProjectDomain = needsProjectDomain ? await resolveProjectDomain(lead).catch(() => void 0) : void 0;
    return Promise.all(lead.sources.slice(0, MAX_SOURCES_PER_CANDIDATE).map(async (source2) => {
      const result = await fetchSourceOnce(source2.url);
      if (result.status !== "ok") {
        return { lead, entity, source: source2, officialProjectDomain, officialInvestorDomain, investorDomainProof, failed: true };
      }
      const classification = sourceClass(
        result.url,
        officialInvestorDomain,
        officialInvestorDomainScope,
        officialProjectDomain,
        entity.attribution
      );
      const match = supportsPortfolioRelationship({
        document: result,
        sourceClass: classification,
        subjectAliases: investorAliases,
        projectName: lead.projectName
      });
      return { lead, entity, source: source2, document: result, sourceClass: classification, officialProjectDomain, officialInvestorDomain, investorDomainProof, match, failed: false };
    }));
  }))).flat();
  const supported = inspections.filter((item) => Boolean(item.entity && item.document && item.sourceClass && item.match?.supported));
  const failed = inspections.filter((item) => item.failed).length;
  const successfulFetches = inspections.length - failed;
  const byProject = /* @__PURE__ */ new Map();
  for (const item of supported) {
    const key = `${item.entity.name.toLowerCase()}::${item.lead.projectName.toLowerCase()}`;
    byProject.set(key, [...byProject.get(key) ?? [], item]);
  }
  const confirmedProjects = /* @__PURE__ */ new Set();
  const confirmationByProject = /* @__PURE__ */ new Map();
  for (const [project, rows] of byProject) {
    const authoritative = rows.some((row) => row.sourceClass === "first_party_subject" || row.sourceClass === "first_party_investor" || row.sourceClass === "public_primary");
    const pressDomains = new Set(rows.filter((row) => row.sourceClass === "independent_press").map((row) => registrableApprox2(row.document.host)));
    const pressFingerprints = new Set(rows.filter((row) => row.sourceClass === "independent_press").map((row) => createHash8("sha256").update(normalized(row.match.excerpt ?? "")).digest("hex")));
    const pressConfirmed = pressDomains.size >= 2 && pressFingerprints.size >= 2;
    const confirmed = authoritative || pressConfirmed;
    confirmationByProject.set(project, { confirmed, pressConfirmed });
    if (confirmed) confirmedProjects.add(project);
  }
  for (const row of supported) {
    const projectKey = `${row.entity.name.toLowerCase()}::${row.lead.projectName.toLowerCase()}`;
    const confirmation = confirmationByProject.get(projectKey);
    const sourceConfirmed = Boolean(confirmation?.confirmed && (row.sourceClass === "first_party_subject" || row.sourceClass === "first_party_investor" || row.sourceClass === "public_primary" || row.sourceClass === "independent_press" && confirmation.pressConfirmed));
    const unhashed = {
      kind: "portfolio_relationship",
      provider: "portfolio-web",
      title: `${row.entity.name} \u2192 ${row.lead.projectName}`,
      sourceUrl: row.document.url,
      capturedAt: row.document.capturedAt,
      sourceContentHash: row.document.contentHash,
      excerpt: row.match.excerpt,
      match: sourceConfirmed ? "relationship_confirmed" : "candidate",
      relationship: "invested_in",
      subjectName: ctx.evidence.profile.resolved_name || ctx.evidence.profile.display_name || ctx.handle,
      subjectHandle: row.entity.subjectHandle ?? ctx.handle,
      investorEntityName: row.entity.name,
      ...row.entity.handle && (row.entity.handleTrusted || row.officialInvestorDomain) ? { investorEntityHandle: row.entity.handle } : {},
      ...row.officialInvestorDomain ? { investorEntityDomain: row.officialInvestorDomain } : {},
      ...row.investorDomainProof ? {
        investorDomainSourceUrl: row.investorDomainProof.sourceUrl,
        investorDomainSourceContentHash: row.investorDomainProof.sourceContentHash,
        investorDomainCapturedAt: row.investorDomainProof.capturedAt,
        investorDomainSourceKind: row.investorDomainProof.sourceKind,
        investorDomainProfileName: row.investorDomainProof.profileName,
        investorDomainProfileWebsite: row.investorDomainProof.profileWebsite
      } : {},
      attribution: row.entity.attribution,
      ...row.entity.attributionSourceUrl ? { attributionSourceUrl: row.entity.attributionSourceUrl } : {},
      ...row.entity.attributionSourceContentHash ? { attributionSourceContentHash: row.entity.attributionSourceContentHash } : {},
      ...row.entity.attributionCapturedAt ? { attributionCapturedAt: row.entity.attributionCapturedAt } : {},
      ...row.entity.attributionSourceKind ? { attributionSourceKind: row.entity.attributionSourceKind } : {},
      projectName: row.lead.projectName,
      ...row.officialProjectDomain ? { projectDomain: row.officialProjectDomain } : {},
      ...row.officialProjectDomain && row.lead.projectHandle ? { projectHandle: row.lead.projectHandle } : {},
      sourceClass: row.sourceClass
    };
    const artifact = { ...unhashed, contentHash: artifactHash(unhashed) };
    const exists = ctx.evidence.sourceArtifacts.some(
      (candidate) => candidate.kind === artifact.kind && candidate.investorEntityName?.toLowerCase() === artifact.investorEntityName?.toLowerCase() && candidate.projectName?.toLowerCase() === artifact.projectName?.toLowerCase() && candidate.sourceUrl === artifact.sourceUrl
    );
    if (!exists) ctx.evidence.sourceArtifacts.push(artifact);
  }
  const reportedProjects = [...byProject.keys()].filter((project) => !confirmedProjects.has(project)).length;
  const incompleteDispositions = unattributedCandidates + sourceLessCandidates + failed;
  if (confirmedProjects.size > 0 && incompleteDispositions > 0) {
    const recordedOutcome = hasRecordedPartialPortfolioOutcome(confirmedProjects.size, incompleteDispositions);
    ctx.recordCheck?.({
      id: "vc-portfolio-track-record",
      status: recordedOutcome ? "confirmed" : "unavailable",
      note: recordedOutcome ? `${confirmedProjects.size} unique portfolio relationships were verified from fetched first-party, primary, or independently corroborated sources; bounded candidate coverage remained partial: ${unattributedCandidates} could not be safely attributed, ${sourceLessCandidates} had no inspectable source, and ${failed} cited source fetch${failed === 1 ? "" : "es"} failed. Incomplete candidates were not used as verification` : `${confirmedProjects.size} portfolio relationship${confirmedProjects.size === 1 ? " was" : "s were"} verified, but coverage remained too weak to record a track-record outcome: ${unattributedCandidates} candidate${unattributedCandidates === 1 ? "" : "s"} could not be safely attributed, ${sourceLessCandidates} had no inspectable source, and ${failed} cited source fetch${failed === 1 ? "" : "es"} failed`,
      provider: "portfolio-web",
      sourceCount: confirmedProjects.size
    });
    ctx.emit({ phase: "Investor", label: "Portfolio verification partial", detail: `${confirmedProjects.size} relationship${confirmedProjects.size === 1 ? "" : "s"} verified, but ${incompleteDispositions} candidate disposition${incompleteDispositions === 1 ? " remains" : "s remain"} incomplete.`, source: "portfolio-web", tone: "warn" });
    return { state: "partial", detail: `${confirmedProjects.size} verified \xB7 ${reportedProjects} reported \xB7 ${incompleteDispositions} incomplete` };
  }
  if (confirmedProjects.size > 0) {
    ctx.recordCheck?.({
      id: "vc-portfolio-track-record",
      status: "confirmed",
      note: `${confirmedProjects.size} unique portfolio relationship${confirmedProjects.size === 1 ? "" : "s"} verified from fetched first-party, primary, or independently corroborated sources${reportedProjects ? ` \xB7 ${reportedProjects} additional project${reportedProjects === 1 ? "" : "s"} remained reported-only` : ""}`,
      provider: "portfolio-web",
      sourceCount: confirmedProjects.size
    });
    ctx.emit({ phase: "Investor", label: "Portfolio relationships verified", detail: `${confirmedProjects.size}/${leads.length} source-linked candidate${leads.length === 1 ? "" : "s"} met the deterministic confirmation threshold.`, source: "portfolio-web", tone: "good" });
    return { state: "executed", detail: `${confirmedProjects.size} verified \xB7 ${reportedProjects} reported` };
  }
  if (!inspections.length || incompleteDispositions > 0) {
    ctx.recordCheck?.({
      id: "vc-portfolio-track-record",
      status: "unavailable",
      note: inspections.length ? `Portfolio verification was incomplete: ${failed} of ${inspections.length} cited source fetch${inspections.length === 1 ? "" : "es"} failed, ${unattributedCandidates} candidate${unattributedCandidates === 1 ? "" : "s"} could not be safely attributed, ${sourceLessCandidates} had no inspectable source, and no relationship reached the confirmation threshold` : `Portfolio candidates were returned without a complete inspectable attribution path (${unattributedCandidates} unattributed \xB7 ${sourceLessCandidates} without sources)`,
      provider: "portfolio-web",
      sourceCount: 0
    });
    return { state: successfulFetches ? "partial" : "failed", detail: `${successfulFetches} fetched \xB7 ${incompleteDispositions} incomplete \xB7 0 verified` };
  }
  ctx.recordCheck?.({
    id: "vc-portfolio-track-record",
    status: "checked-empty",
    note: `Fetched and inspected ${successfulFetches} cited source${successfulFetches === 1 ? "" : "s"} across ${leads.length} candidate project${leads.length === 1 ? "" : "s"}; no relationship met the verification threshold${reportedProjects ? ` (${reportedProjects} remained reported-only)` : ""}. This is not proof that no portfolio exists`,
    provider: "portfolio-web"
  });
  ctx.emit({ phase: "Investor", label: "Portfolio coverage limited", detail: "The bounded source review completed, but no investment relationship met the confirmation threshold.", source: "portfolio-web", tone: "warn" });
  return { state: "executed", detail: `${successfulFetches} sources inspected \xB7 0 verified` };
}

// server/adapters/fundScale.ts
import { createHash as createHash9 } from "node:crypto";
import { isIP as isIP4 } from "node:net";
var MAX_CANDIDATES2 = 6;
var MAX_SOURCES_PER_CANDIDATE2 = 3;
var MIN_FUND_AMOUNT_USD = 1e5;
var MAX_FUND_AMOUNT_USD = 1e13;
var CURRENT_AUM_MAX_AGE_MS = 731 * 24 * 60 * 60 * 1e3;
var AUM_CORROBORATION_WINDOW_MS2 = 90 * 24 * 60 * 60 * 1e3;
var AUM_AMOUNT_TOLERANCE = 0.1;
var PRIMARY_HOSTS2 = [
  "sec.gov",
  "fca.org.uk",
  "gov.uk",
  "companieshouse.gov.uk",
  "asic.gov.au",
  "sedarplus.ca"
];
var PRESS_HOSTS2 = [
  "reuters.com",
  "bloomberg.com",
  "ft.com",
  "wsj.com",
  "techcrunch.com",
  "fortune.com",
  "coindesk.com",
  "theblock.co",
  "decrypt.co",
  "blockworks.co",
  "venturebeat.com"
];
var SENSITIVE_URL_PARAM5 = /^(?:(?:x[-_]?(?:amz|goog)|x[-_](?:oss|cos))[-_].+|x[-_]ms[-_](?:signature|token|credential)|access[_-]?token|api[_-]?key|key|token|signature|sig|auth|credential|credentials|security[_-]?token|session[_-]?token|awsaccesskeyid|googleaccessid|key[_-]?pair[_-]?id|policy|cf[_-]?access[_-]?token)$/i;
var clean3 = (value, max) => typeof value === "string" && value.trim() ? value.trim().slice(0, max) : void 0;
var normalized2 = (value) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9@$._ -]+/g, " ").replace(/\s+/g, " ").trim();
var compact2 = (value) => normalized2(value).replace(/[^a-z0-9]+/g, "");
var regexEscape4 = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function entityNamesMatch2(leftRaw, rightRaw) {
  const left = compact2(leftRaw);
  const right = compact2(rightRaw);
  if (!left || !right) return false;
  return left === right || Math.min(left.length, right.length) >= 5 && (left.includes(right) || right.includes(left));
}
function entityPattern2(entity, caseSensitive = false) {
  const words = normalized2(entity.replace(/^@/, "")).split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length || words.length === 1 && words[0].length < 2) return null;
  const phrase = words.map(regexEscape4).join("[^A-Za-z0-9]+");
  return new RegExp(`(?:^|[^A-Za-z0-9])${phrase}(?=$|[^A-Za-z0-9])`, caseSensitive ? "" : "i");
}
function containsEntity2(text2, entity) {
  const words = normalized2(entity.replace(/^@/, "")).split(/[^a-z0-9]+/).filter(Boolean);
  const caseSensitive = words.length === 1 && words[0].length <= 4;
  return entityPattern2(entity, caseSensitive)?.test(text2) ?? false;
}
function safeCandidateUrl3(value) {
  if (typeof value !== "string" || value.length > 2e3) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (url.protocol !== "https:" && url.protocol !== "http:" || url.username || url.password || !host || isIP4(host) || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || [...url.searchParams.keys()].some((key) => SENSITIVE_URL_PARAM5.test(key))) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}
function parsePayload2(text2) {
  const match = text2.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function parseFundScaleCandidates(text2) {
  const payload = parsePayload2(text2);
  if (!payload || !Array.isArray(payload.fund_scale)) return null;
  const leads = [];
  const seen = /* @__PURE__ */ new Set();
  for (const raw of payload.fund_scale) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const row = raw;
    const fundName = clean3(row.fund_name ?? row.investor_entity, 120);
    if (!fundName) continue;
    const sources = [];
    for (const sourceRaw of Array.isArray(row.sources) ? row.sources : []) {
      if (!sourceRaw || typeof sourceRaw !== "object" || Array.isArray(sourceRaw)) continue;
      const source2 = sourceRaw;
      const url = safeCandidateUrl3(source2.url);
      if (!url) continue;
      const title = clean3(source2.title, 180);
      sources.push({ url, ...title ? { title } : {} });
    }
    const singularUrl = safeCandidateUrl3(row.source_url);
    if (singularUrl) {
      const title = clean3(row.source_title, 180);
      sources.push({ url: singularUrl, ...title ? { title } : {} });
    }
    const uniqueSources = sources.filter(
      (source2, index) => sources.findIndex((candidate) => candidate.url === source2.url) === index
    ).slice(0, MAX_SOURCES_PER_CANDIDATE2);
    const fundVehicleHint = clean3(row.fund_vehicle, 160);
    const fundHandleRaw = clean3(row.fund_x_handle ?? row.investor_x_handle, 40)?.replace(/^@/, "");
    const fundHandle = fundHandleRaw && /^[A-Za-z0-9_]{2,30}$/.test(fundHandleRaw) ? `@${fundHandleRaw}` : void 0;
    const attribution = row.attribution === "affiliated_fund" ? "affiliated_fund" : row.attribution === "direct_subject" ? "direct_subject" : void 0;
    const metricHint = ["aum", "fund_vehicle", "first_close", "final_close"].includes(String(row.metric_hint)) ? row.metric_hint : void 0;
    const amountHint = typeof row.amount_hint_usd === "number" && Number.isFinite(row.amount_hint_usd) && row.amount_hint_usd >= MIN_FUND_AMOUNT_USD && row.amount_hint_usd <= MAX_FUND_AMOUNT_USD ? Math.round(row.amount_hint_usd) : void 0;
    const key = `${compact2(fundName)}::${compact2(fundVehicleHint ?? "")}::${uniqueSources.map((source2) => source2.url).join("|")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    leads.push({
      fundName,
      ...fundVehicleHint ? { fundVehicleHint } : {},
      ...fundHandle ? { fundHandle } : {},
      ...attribution ? { attribution } : {},
      ...metricHint ? { metricHint } : {},
      ...amountHint ? { amountHintUsd: amountHint } : {},
      sources: uniqueSources,
      evidence_origin: "model_lead",
      artifact_verified: false,
      provider: "grok"
    });
    if (leads.length >= MAX_CANDIDATES2) break;
  }
  return leads;
}
async function discoverFundScaleCandidates(ctx) {
  if (!env("XAI_API_KEY")) return null;
  const text2 = await discoverInvestorEvidenceText(ctx);
  if (!text2) return null;
  const shared = parseFundScaleCandidates(text2);
  if (!shared) return null;
  const sourceLinked = shared.filter((lead) => lead.sources.length > 0);
  if (sourceLinked.length > 0) return shared;
  const focusedText = await discoverFocusedFundScaleEvidenceText(ctx);
  return focusedText ? parseFundScaleCandidates(focusedText) : null;
}
var USD_AMOUNT = /(?<![A-Za-z])(?:US\s*\$|USD\s*|\$)\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)\s*(trillion|tn|billion|bn|million|mm|mn|thousand|[tbmk])?\b/gi;
var NON_USD_CURRENCY_SUFFIX = /^\s*(?:[,;(]\s*)?(?:(?:denominated\s+)?in\s+)?(?:AED|ARS|AUD|BRL|CAD|CHF|CLP|CNY|COP|DKK|EUR|GBP|HKD|IDR|ILS|INR|JPY|KRW|MXN|MYR|NGN|NOK|NZD|PHP|PLN|RMB|RUB|SAR|SEK|SGD|THB|TRY|TWD|ZAR|Australian(?:\s+dollars?)?|Canadian(?:\s+dollars?)?|Hong\s+Kong(?:\s+dollars?)?|New\s+Zealand(?:\s+dollars?)?|Singapore(?:\s+dollars?)?|pounds?\s+sterling|euros?|yen|yuan)\b/i;
var NON_USD_SYMBOL_PREFIX = /(?:^|[\s(])(?:A|AU|C|CA|HK|NZ|S|SG)\s*$/;
function parseUsdAmounts(text2) {
  const amounts = [];
  for (const match of text2.matchAll(new RegExp(USD_AMOUNT.source, USD_AMOUNT.flags))) {
    const numericText = match[1];
    const unit = (match[2] ?? "").toLowerCase();
    if (!unit && !numericText.includes(",")) continue;
    const numeric = Number(numericText.replace(/,/g, ""));
    const multiplier = unit === "t" || unit === "tn" || unit === "trillion" ? 1e12 : unit === "b" || unit === "bn" || unit === "billion" ? 1e9 : unit === "m" || unit === "mm" || unit === "mn" || unit === "million" ? 1e6 : unit === "k" || unit === "thousand" ? 1e3 : 1;
    const amountUsd = Math.round(numeric * multiplier);
    if (!Number.isSafeInteger(amountUsd) || amountUsd < MIN_FUND_AMOUNT_USD || amountUsd > MAX_FUND_AMOUNT_USD) continue;
    const start = match.index ?? 0;
    const raw = match[0];
    const explicitUsdPrefix = /^(?:US\s*\$|USD\b)/i.test(raw);
    const immediateBefore = text2.slice(Math.max(0, start - 5), start);
    const immediateAfter = text2.slice(start + raw.length, start + raw.length + 40);
    if (!explicitUsdPrefix && NON_USD_SYMBOL_PREFIX.test(immediateBefore) || NON_USD_CURRENCY_SUFFIX.test(immediateAfter)) continue;
    const before = text2.slice(Math.max(0, start - 28), start);
    const qualifier = /\b(?:at least|more than|over)\s*$/i.test(before) ? "at_least" : /\b(?:about|approximately|around|roughly|nearly)\s*$/i.test(before) ? "approximate" : "exact";
    amounts.push({ amountUsd, raw, start, end: start + raw.length, qualifier });
  }
  return amounts;
}
function htmlToVisibleText2(raw) {
  return raw.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<\/?(?:article|aside|blockquote|br|dd|div|dl|dt|figcaption|figure|footer|h[1-6]|header|li|main|nav|ol|p|section|table|tbody|td|th|thead|tr|ul)\b[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;|&#34;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/[\t\f\v ]+/g, " ").replace(/ *\n+ */g, "\n").trim();
}
function safeIsoDate(value, now) {
  if (!value) return void 0;
  const parsed = new Date(value.trim());
  if (!Number.isFinite(parsed.getTime()) || parsed.getTime() > now.getTime() + 24 * 60 * 60 * 1e3) return void 0;
  return parsed.toISOString();
}
function documentPublishedAt(document, now) {
  const raw = document.text.slice(0, 25e4);
  const candidates = [
    raw.match(/["']datePublished["']\s*:\s*["']([^"']+)["']/i)?.[1],
    raw.match(/<(?:meta|time)\b[^>]*(?:property|name|itemprop)=["'](?:article:published_time|datePublished|datepublished)["'][^>]*(?:content|datetime)=["']([^"']+)["']/i)?.[1],
    raw.match(/<(?:meta|time)\b[^>]*(?:content|datetime)=["']([^"']+)["'][^>]*(?:property|name|itemprop)=["'](?:article:published_time|datePublished|datepublished)["']/i)?.[1],
    raw.match(/<time\b[^>]*datetime=["']([^"']+)["']/i)?.[1]
  ];
  return candidates.map((candidate) => safeIsoDate(candidate, now)).find(Boolean);
}
function explicitAsOf(segment, now) {
  const month = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
  const marker2 = "\\bas (?:of|at)\\s+(?:the\\s+)?";
  const iso2 = segment.match(new RegExp(`${marker2}(\\d{4}-\\d{2}-\\d{2})`, "i"))?.[1];
  if (iso2) return safeIsoDate(iso2, now);
  const monthFirst = segment.match(new RegExp(`${marker2}(${month}\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4})`, "i"))?.[1];
  if (monthFirst) return safeIsoDate(monthFirst.replace(/(\d)(?:st|nd|rd|th)\b/i, "$1"), now);
  const dayFirst = segment.match(new RegExp(`${marker2}(\\d{1,2})(?:st|nd|rd|th)?[\\s-]+(${month})[,]?[\\s-]+(\\d{4})`, "i"));
  if (!dayFirst) return void 0;
  return safeIsoDate(`${dayFirst[2]} ${dayFirst[1]}, ${dayFirst[3]}`, now);
}
var TARGET_OR_NEGATED = /\b(?:target(?:ing|ed|s)?|seek(?:ing|s)?|aim(?:ing|s)?|plan(?:ning|s)?|expect(?:ing|s|ed)?|hope(?:s|d|fully)?|could|might|up to|hard cap|proposed|potential|failed to|did not|does not|never|may\s+(?:be|raise|close|launch|seek|target|reach|manage|have))\b/i;
var NON_SCALE_RELATION = [
  /\b(?:deployed|deploying|invested|investing|allocated|allocating|distributed|distributing|returned|returning|spent|spending)\s+(?:approximately\s+|about\s+|around\s+|over\s+|at least\s+)?__amount__/,
  /__amount__\s+(?:was\s+|were\s+|has been\s+|had been\s+)?(?:deployed|invested|allocated|distributed|returned|spent)\b/,
  /\bdry powder\b(?:(?!\b(?:aum|assets under management)\b)[^.;]){0,55}__amount__|__amount__(?:(?!\b(?:aum|assets under management)\b)[^.;]){0,55}\bdry powder\b/,
  /\b(?:valuation|valued at|market cap(?:italization)?|total value locked|tvl|revenue|turnover|sales|purchase price|deal value)\b[^.;]{0,55}__amount__|__amount__[^.;]{0,55}\b(?:valuation|market cap(?:italization)?|total value locked|tvl|revenue|turnover|sales|purchase price|deal value)\b/,
  /\b(?:series\s+[a-z0-9]+|(?:pre-?seed|seed)\s+round|financing|company round)\b[^.;]{0,70}__amount__|__amount__[^.;]{0,70}\b(?:series\s+[a-z0-9]+|(?:pre-?seed|seed)\s+round|financing|company round)\b/,
  /__amount__[^.;]{0,45}\bfrom\s+(?:its|the|a|an)\s+(?:[a-z0-9-]+\s+){0,4}fund\b/
];
var ORDINAL_FUND_NUMBER = /* @__PURE__ */ new Map([
  ["first", 1],
  ["second", 2],
  ["third", 3],
  ["fourth", 4],
  ["fifth", 5],
  ["sixth", 6],
  ["seventh", 7],
  ["eighth", 8],
  ["ninth", 9],
  ["tenth", 10]
]);
var ROMAN_FUND_NUMBER = /* @__PURE__ */ new Map([
  ["i", 1],
  ["ii", 2],
  ["iii", 3],
  ["iv", 4],
  ["v", 5],
  ["vi", 6],
  ["vii", 7],
  ["viii", 8],
  ["ix", 9],
  ["x", 10]
]);
var FUND_NUMBER_ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
var canonicalCategoryLabel = (value) => value.toLowerCase().split(/\s+/).map((part) => `${part[0].toUpperCase()}${part.slice(1)}`).join(" ");
function canonicalFundVehicle(segment) {
  const vehicleText = segment.replace(new RegExp(USD_AMOUNT.source, USD_AMOUNT.flags), " ").replace(/\s+/g, " ");
  const numbered = vehicleText.match(/\b(?:(venture|growth|opportunity|seed|flagship|private equity|digital asset|blockchain|web3|crypto)\s+)?fund\s+(?:no\.?\s*)?([ivx]{1,4}|\d{1,2})\b/i);
  if (numbered) {
    const category2 = numbered[1] ? canonicalCategoryLabel(numbered[1]) : void 0;
    const rawNumber = numbered[2].toLowerCase();
    const value = /^\d+$/.test(rawNumber) ? Number(rawNumber) : ROMAN_FUND_NUMBER.get(rawNumber);
    if (value) {
      const suffix = value <= 10 ? FUND_NUMBER_ROMAN[value] : String(value);
      const label = `${category2 ? `${category2} ` : ""}Fund ${suffix}`;
      return { label, key: `${category2 ? `${compact2(category2)}-` : ""}fund-${value}`, corroboratable: true };
    }
  }
  const ordinalMatch = vehicleText.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(?:(venture|growth|opportunity|seed|flagship|private equity|digital asset|blockchain|web3|crypto)\s+)?fund\b/i);
  const ordinal = ordinalMatch?.[1].toLowerCase() ?? vehicleText.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(?:[a-z0-9-]+\s+){0,3}fund\b/i)?.[1].toLowerCase();
  const ordinalValue = ordinal ? ORDINAL_FUND_NUMBER.get(ordinal) : void 0;
  if (ordinalValue) {
    const category2 = ordinalMatch?.[2] ? canonicalCategoryLabel(ordinalMatch[2]) : void 0;
    const label = `${category2 ? `${category2} ` : ""}Fund ${FUND_NUMBER_ROMAN[ordinalValue]}`;
    return { label, key: `${category2 ? `${compact2(category2)}-` : ""}fund-${ordinalValue}`, corroboratable: true };
  }
  const category = vehicleText.match(/\b(venture|growth|opportunity|seed|flagship|private equity|digital asset|blockchain|web3|crypto)\s+fund\b/i)?.[1].toLowerCase();
  if (category) {
    const canonicalCategory = canonicalCategoryLabel(category);
    return { label: `${canonicalCategory} Fund`, key: `${compact2(canonicalCategory)}-fund`, corroboratable: false };
  }
  return { label: "Unspecified Fund", key: "unspecified-fund", corroboratable: false };
}
function metricAroundAmount(segment, amount) {
  const before = segment.slice(Math.max(0, amount.start - 130), amount.start);
  const after = segment.slice(amount.end, Math.min(segment.length, amount.end + 150));
  const context = `${before} __amount__ ${after}`.toLowerCase();
  const localContext = `${before.slice(-90)} __amount__ ${after.slice(0, 90)}`.toLowerCase();
  if (TARGET_OR_NEGATED.test(localContext) || NON_SCALE_RELATION.some((pattern) => pattern.test(localContext))) return null;
  const aum = /\b(?:assets under management|aum)\s*(?::|of|total(?:ing)?|were|was|is|stood at|reached)?\s*__amount__/.test(context) || /__amount__\s+(?:in\s+)?(?:assets under management|aum|managed assets)\b/.test(context) || /\b(?:manages?|managed|oversees?|oversaw)\s*__amount__\s+(?:in\s+)?(?:assets under management|aum|managed assets)\b/.test(context);
  if (aum) return "reported_aum";
  const committed = /\bcommitted capital\b/.test(context) && (/\bcommitted capital[^.;]{0,70}__amount__/.test(context) || /__amount__[^.;]{0,70}\b(?:in )?committed capital\b/.test(context));
  const fundVehicle = committed || /__amount__\s+(?:(?:crypto|venture|growth|opportunity|seed|flagship|web3|blockchain|digital asset|private equity|investment)\s+){0,3}fund\b/.test(context) || /\bfund\b[^.;]{0,55}\b(?:size(?:d)?(?: at| is)?|of|at|with|total(?:ing|led)?|closed at)\s*__amount__/.test(context) || /\b(?:raised|closed|secured|launched|announced|completed)[^.;]{0,110}__amount__[^.;]{0,100}\bfund\b/.test(context);
  if (!fundVehicle) return null;
  if (/\bfirst close\b/.test(context)) return "first_close";
  if (/\bfinal close\b|\bclosed (?:its|the|a)[^.;]{0,70}fund\b/.test(context)) return "final_close";
  return "fund_vehicle";
}
function isAumMetric2(metric) {
  return metric === "reported_aum" || metric === "regulatory_aum";
}
function hasExplicitFirstPersonOwnership(segment) {
  return /\bour\b[^.;]{0,100}\b(?:fund|vehicle|assets under management|aum)\b/i.test(segment) || /\bwe(?:'ve| have)?\s+(?:currently\s+)?(?:manage|managed|oversee|oversaw)\b/i.test(segment) || /\bwe(?:'ve| have)?\s+(?:currently\s+)?(?:raised|closed|secured|launched|announced|completed)\s+(?:(?:our|a|an|the|new)\b|fund\b)/i.test(segment) || /\bwe\s+are\s+(?:launching|announcing|closing)\s+(?:(?:our|a|an|the|new)\b|fund\b)/i.test(segment);
}
function supportsFundScaleClaim(input) {
  const now = input.now ?? /* @__PURE__ */ new Date();
  try {
    if (input.sourceClass !== "other_public" && new URL(input.document.url).protocol !== "https:") return [];
  } catch {
    return [];
  }
  if (input.sourceClass === "public_primary" && !isRegulatoryRecordUrl(input.document.url)) return [];
  const visible = htmlToVisibleText2(input.document.text);
  const publishedAt = documentPublishedAt(input.document, now);
  const firstParty = input.sourceClass === "first_party_subject" || input.sourceClass === "first_party_investor";
  const segments = visible.split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9@])/).map((segment) => segment.trim()).filter((segment) => segment.length >= 8 && segment.length <= 1600);
  const matches = [];
  const seen = /* @__PURE__ */ new Set();
  for (const segment of segments) {
    const entityMentioned = input.subjectAliases.some((alias) => containsEntity2(segment, alias));
    if (!entityMentioned && (!firstParty || !hasExplicitFirstPersonOwnership(segment))) continue;
    for (const amount of parseUsdAmounts(segment)) {
      let metric = metricAroundAmount(segment, amount);
      if (!metric) continue;
      if (metric === "reported_aum" && input.sourceClass === "public_primary") metric = "regulatory_aum";
      const asOf = isAumMetric2(metric) ? explicitAsOf(segment, now) : void 0;
      const temporalState = isAumMetric2(metric) ? asOf ? now.getTime() - new Date(asOf).getTime() <= CURRENT_AUM_MAX_AGE_MS ? "current" : "historical" : "unknown" : "fixed_historical";
      const eligibleForConfirmation = !isAumMetric2(metric) || temporalState === "current";
      const qualifier = metric === "first_close" && amount.qualifier === "exact" ? "at_least" : amount.qualifier;
      const vehicle = isAumMetric2(metric) ? void 0 : canonicalFundVehicle(segment);
      const key = `${metric}:${amount.amountUsd}:${qualifier}:${vehicle?.key ?? "firm-wide"}:${normalized2(segment)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push({
        amountUsd: amount.amountUsd,
        metric,
        qualifier,
        excerpt: segment.slice(0, 700),
        ...vehicle ? {
          fundVehicle: vehicle.label,
          vehicleIdentityKey: vehicle.key,
          vehicleCorroboratable: vehicle.corroboratable
        } : {},
        ...asOf ? { asOf } : {},
        ...publishedAt ? { publishedAt } : {},
        temporalState,
        eligibleForConfirmation
      });
      if (matches.length >= 8) return matches;
    }
  }
  return matches;
}
function hostMatches3(host, expected) {
  const left = host.replace(/^www\./i, "").toLowerCase();
  const right = expected.replace(/^www\./i, "").toLowerCase();
  return left === right || left.endsWith(`.${right}`);
}
var listedHost3 = (host, list) => list.some((candidate) => hostMatches3(host, candidate));
function isRegulatoryRecordUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.replace(/^www\./i, "").toLowerCase();
  const path = url.pathname;
  if (host === "sec.gov" || host.endsWith(".sec.gov")) {
    return /^\/Archives\/edgar\/data\/\d{1,12}\/\d{18}\/[^/]+\.(?:html?|txt|xml|json)$/i.test(path) || /^\/firm\/summary\/\d+\/?$/i.test(path);
  }
  if (host === "fca.org.uk" || host.endsWith(".fca.org.uk")) {
    return /\/(?:firm|individual)\/details\/\d+/i.test(path) || /\/services\/v1\/(?:firm|individual)\//i.test(path);
  }
  if (host === "companieshouse.gov.uk" || host.endsWith(".companieshouse.gov.uk") || host === "find-and-update.company-information.service.gov.uk" || host === "api.company-information.service.gov.uk") {
    return /^\/company\/[A-Z0-9]{6,12}(?:\/|$)/i.test(path);
  }
  return false;
}
function sourceClass2(document, investorDomain, investorDomainScope, attribution) {
  let url;
  try {
    url = new URL(document.url);
    if (url.protocol !== "https:") return "other_public";
  } catch {
    return "other_public";
  }
  const host = url.hostname;
  if (listedHost3(host, PRIMARY_HOSTS2) && isRegulatoryRecordUrl(document.url)) return "public_primary";
  if (listedHost3(host, PRESS_HOSTS2)) return "independent_press";
  if (investorDomain && hostMatches3(host, investorDomain) && (!investorDomainScope || sourceMatchesOfficialWebsiteScope(document.url, investorDomainScope))) {
    return attribution === "direct_subject" ? "first_party_subject" : "first_party_investor";
  }
  return "other_public";
}
function registrableApprox3(host) {
  const parts = host.replace(/^www\./i, "").toLowerCase().split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const twoLevelSuffix = /* @__PURE__ */ new Set(["co.uk", "org.uk", "com.au", "com.br", "co.nz", "co.jp"]);
  const tail = parts.slice(-2).join(".");
  return twoLevelSuffix.has(tail) ? parts.slice(-3).join(".") : tail;
}
function documentRegistrableDomain(document) {
  try {
    return registrableApprox3(new URL(document.url).hostname);
  } catch {
    return "";
  }
}
function syntheticPortfolioLead(lead) {
  return {
    projectName: lead.fundVehicleHint || `${lead.fundName} fund scale`,
    investorEntityName: lead.fundName,
    ...lead.fundHandle ? { investorEntityHandle: lead.fundHandle } : {},
    ...lead.attribution ? { attribution: lead.attribution } : {},
    relationship: "invested_in",
    sources: lead.sources.map((source2) => ({ ...source2 })),
    evidence_origin: "model_lead",
    artifact_verified: false,
    provider: "grok"
  };
}
function frozenInvestorDomainProof(artifact) {
  if (!artifact.investorEntityDomain || !artifact.investorDomainSourceUrl || !artifact.investorDomainSourceContentHash || !artifact.investorDomainCapturedAt || artifact.investorDomainSourceKind !== "provider_profile" || !artifact.investorDomainProfileName || !artifact.investorDomainProfileWebsite) return void 0;
  return {
    domain: artifact.investorEntityDomain,
    sourceUrl: artifact.investorDomainSourceUrl,
    sourceContentHash: artifact.investorDomainSourceContentHash,
    capturedAt: artifact.investorDomainCapturedAt,
    sourceKind: artifact.investorDomainSourceKind,
    profileName: artifact.investorDomainProfileName,
    profileWebsite: artifact.investorDomainProfileWebsite
  };
}
function resolveFundEntity(ctx, lead, now) {
  const existing = ctx.evidence.sourceArtifacts.find(
    (artifact) => artifact.kind === "portfolio_relationship" && artifact.match === "relationship_confirmed" && artifact.investorEntityName && entityNamesMatch2(artifact.investorEntityName, lead.fundName)
  );
  if (existing?.investorEntityName && existing.attribution) {
    const domainProof = frozenInvestorDomainProof(existing);
    return {
      name: existing.investorEntityName,
      aliases: [existing.investorEntityName, lead.fundName],
      ...existing.investorEntityHandle ? { handle: existing.investorEntityHandle } : {},
      handleTrusted: Boolean(existing.investorEntityHandle),
      ...existing.investorEntityDomain ? { domain: existing.investorEntityDomain } : {},
      ...domainProof ? { domainScope: domainProof.profileWebsite } : {},
      ...domainProof ? { domainProof } : {},
      attribution: existing.attribution,
      entityType: "organization",
      ...existing.subjectHandle ? { subjectHandle: existing.subjectHandle } : {},
      ...existing.attributionSourceUrl ? { attributionSourceUrl: existing.attributionSourceUrl } : {},
      ...existing.attributionSourceContentHash ? { attributionSourceContentHash: existing.attributionSourceContentHash } : {},
      ...existing.attributionCapturedAt ? { attributionCapturedAt: existing.attributionCapturedAt } : {},
      ...existing.attributionSourceKind ? { attributionSourceKind: existing.attributionSourceKind } : {}
    };
  }
  return portfolioEntityForLead(ctx, syntheticPortfolioLead(lead), now);
}
function claimGroupMetric(metric) {
  return metric;
}
function artifactHash2(artifact) {
  return createHash9("sha256").update(JSON.stringify(artifact)).digest("hex");
}
function amountLabel(amountUsd) {
  if (amountUsd >= 1e12) return `$${(amountUsd / 1e12).toFixed(amountUsd % 1e12 ? 1 : 0)}T`;
  if (amountUsd >= 1e9) return `$${(amountUsd / 1e9).toFixed(amountUsd % 1e9 ? 1 : 0)}B`;
  if (amountUsd >= 1e6) return `$${(amountUsd / 1e6).toFixed(amountUsd % 1e6 ? 1 : 0)}M`;
  return `$${amountUsd.toLocaleString("en-US")}`;
}
function amountAgreement(left, right, tolerance) {
  return Math.abs(left - right) / Math.max(left, right) <= tolerance;
}
function rowClaimBase(row) {
  const metric = claimGroupMetric(row.match.metric);
  const vehicle = isAumMetric2(row.match.metric) ? "firm-wide-aum" : row.match.vehicleIdentityKey ?? "unspecified-fund";
  return `${compact2(row.entity.name)}::${row.entity.attribution}::${metric}::${vehicle}`;
}
function deterministicClaimId(base, rows) {
  const amounts = rows.map((row) => row.match.amountUsd).sort((left, right) => left - right);
  const representativeAmount = amounts[Math.floor((amounts.length - 1) / 2)];
  const dates = rows.map((row) => row.match.asOf).filter((value) => Boolean(value)).map((value) => new Date(value).getTime()).sort((left, right) => left - right);
  const representativeDate = dates.length ? new Date(dates[Math.floor((dates.length - 1) / 2)]).toISOString().slice(0, 10) : "fixed";
  const digest = createHash9("sha256").update(JSON.stringify({ base, representativeAmount, representativeDate })).digest("hex");
  return `fund_scale_claim_v1_${digest}`;
}
function clusterSupportedRows(rows) {
  const sorted = [...rows].sort((left, right) => rowClaimBase(left).localeCompare(rowClaimBase(right)) || left.match.amountUsd - right.match.amountUsd || String(left.match.asOf ?? "").localeCompare(String(right.match.asOf ?? "")) || left.document.url.localeCompare(right.document.url));
  const clusters = [];
  for (const row of sorted) {
    const base = rowClaimBase(row);
    const tolerance = isAumMetric2(row.match.metric) ? AUM_AMOUNT_TOLERANCE : 0.01;
    const rowDate = row.match.asOf ? new Date(row.match.asOf).getTime() : void 0;
    const cluster = clusters.find((candidate) => candidate.base === base && candidate.rows.every((existing) => {
      if (!amountAgreement(row.match.amountUsd, existing.match.amountUsd, tolerance)) return false;
      if (!isAumMetric2(row.match.metric)) return true;
      const existingDate = existing.match.asOf ? new Date(existing.match.asOf).getTime() : void 0;
      if (rowDate === void 0 || existingDate === void 0) return rowDate === existingDate;
      return Math.abs(rowDate - existingDate) <= AUM_CORROBORATION_WINDOW_MS2;
    }));
    if (cluster) cluster.rows.push(row);
    else clusters.push({ base, rows: [row] });
  }
  return clusters.flatMap((cluster) => {
    cluster.rows.sort((left, right) => left.document.url.localeCompare(right.document.url));
    const claimKey = deterministicClaimId(cluster.base, cluster.rows);
    return cluster.rows.map((row) => ({ ...row, claimKey }));
  });
}
async function collectFundScale(ctx, dependencies = {}) {
  const discover = dependencies.discover ?? discoverFundScaleCandidates;
  const fetchSource = dependencies.fetchSource ?? fetchPublicText;
  const lookupProfile = dependencies.lookupProfile ?? getProfile2;
  const resolveEntity = dependencies.resolveEntity ?? resolveFundEntity;
  const now = dependencies.now?.() ?? /* @__PURE__ */ new Date();
  const resolveInvestorDomain = dependencies.resolveInvestorDomain ?? ((lead, entity) => defaultInvestorDomainResolver(syntheticPortfolioLead(lead), entity, lookupProfile, now));
  const investorDomainByEntity = /* @__PURE__ */ new Map();
  const sourceByUrl = /* @__PURE__ */ new Map();
  const fetchSourceOnce = (url) => {
    const key = new URL(url).toString();
    const existing = sourceByUrl.get(key);
    if (existing) return existing;
    const pending = fetchSource(url).then((result) => {
      recordCall(
        "fund-scale-web",
        "source-fetch",
        0,
        result.status === "ok" ? "source_fetched" : result.reason,
        result.status === "ok" ? "succeeded" : "failed"
      );
      return result;
    });
    sourceByUrl.set(key, pending);
    return pending;
  };
  const resolveInvestorDomainOnce = (lead, entity) => {
    const key = `${entity.attribution}::${compact2(entity.name)}::${entity.handle?.replace(/^@/, "").toLowerCase() ?? ""}`;
    const existing = investorDomainByEntity.get(key);
    if (existing) return existing;
    const pending = resolveInvestorDomain(lead, entity).catch(() => entity.domain);
    investorDomainByEntity.set(key, pending);
    return pending;
  };
  if (!dependencies.discover && !env("XAI_API_KEY")) {
    return { state: "skipped", detail: "source-linked fund-scale discovery is not configured" };
  }
  ctx.emit({
    phase: "Investor",
    label: "Fund scale evidence",
    detail: "Fetching cited fund closes and AUM claims, then re-deriving the entity, metric, USD amount, and date before scoring\u2026",
    source: "grok \xB7 manager pages \xB7 regulatory sources \xB7 independent press",
    tone: "neutral"
  });
  const leads = await discover(ctx);
  if (!leads) return { state: "failed", detail: "fund-scale discovery failed" };
  if (!leads.length) {
    ctx.emit({
      phase: "Investor",
      label: "Fund scale unavailable",
      detail: "Discovery returned no cited scale claim. Model silence was not treated as proof of a small fund or angel tier.",
      source: "fund-scale-web",
      tone: "warn"
    });
    return { state: "partial", detail: "0 source-linked fund-scale candidates" };
  }
  const entityByLead = new Map(
    leads.slice(0, MAX_CANDIDATES2).map((lead) => [lead, resolveEntity(ctx, lead, now)])
  );
  const unattributed = [...entityByLead.values()].filter((entity) => !entity).length;
  const sourceLess = [...entityByLead.entries()].filter(([lead, entity]) => Boolean(entity) && lead.sources.length === 0).length;
  const inspections = (await Promise.all(leads.slice(0, MAX_CANDIDATES2).map(async (lead) => {
    const entity = entityByLead.get(lead) ?? null;
    if (!entity) return [];
    const resolvedInvestorDomain = await resolveInvestorDomainOnce(lead, entity);
    const resolvedDomain = typeof resolvedInvestorDomain === "string" ? resolvedInvestorDomain : resolvedInvestorDomain?.domain;
    const officialInvestorDomain = domainFromWebsite(resolvedDomain);
    const investorDomainProof = typeof resolvedInvestorDomain === "object" && officialInvestorDomain === resolvedInvestorDomain.domain ? { ...resolvedInvestorDomain, domain: officialInvestorDomain } : void 0;
    const officialInvestorDomainScope = investorDomainProof?.profileWebsite ?? entity.domainScope;
    const aliases = [
      ...entity.aliases,
      entity.handle && (entity.handleTrusted || officialInvestorDomain) ? entity.handle.replace(/^@/, "") : void 0
    ].filter((value) => Boolean(value?.trim()));
    return Promise.all(lead.sources.slice(0, MAX_SOURCES_PER_CANDIDATE2).map(async (source2) => {
      const result = await fetchSourceOnce(source2.url);
      if (result.status !== "ok") {
        return { lead, entity, source: source2, officialInvestorDomain, investorDomainProof, matches: [], failed: true };
      }
      const classification = sourceClass2(result, officialInvestorDomain, officialInvestorDomainScope, entity.attribution);
      const matches = supportsFundScaleClaim({ document: result, sourceClass: classification, subjectAliases: aliases, now });
      return { lead, entity, source: source2, document: result, sourceClass: classification, officialInvestorDomain, investorDomainProof, matches, failed: false };
    }));
  }))).flat();
  const unclusteredSupported = inspections.flatMap((inspection) => {
    if (!inspection.entity || !inspection.document || !inspection.sourceClass) return [];
    return inspection.matches.map((match) => ({
      ...inspection,
      entity: inspection.entity,
      document: inspection.document,
      sourceClass: inspection.sourceClass,
      match
    }));
  });
  const supported = clusterSupportedRows(unclusteredSupported);
  const failed = inspections.filter((inspection) => inspection.failed).length;
  const successfulFetches = inspections.length - failed;
  const groups = /* @__PURE__ */ new Map();
  for (const row of supported) groups.set(row.claimKey, [...groups.get(row.claimKey) ?? [], row]);
  const baseRowEligibleForConfirmation = (row) => {
    if (!row.match.eligibleForConfirmation) return false;
    if (row.entity.attribution === "affiliated_fund" && row.sourceClass === "first_party_investor" && !row.investorDomainProof) return false;
    if (row.entity.attribution === "affiliated_fund" && row.entity.attributionSourceKind !== "provider_profile") return false;
    return true;
  };
  const pressRowEligible = (row) => baseRowEligibleForConfirmation(row) && row.sourceClass === "independent_press" && (isAumMetric2(row.match.metric) || row.match.vehicleCorroboratable === true);
  const independentPressPair = (row, other) => {
    const rowDomain = documentRegistrableDomain(row.document);
    const otherDomain = documentRegistrableDomain(other.document);
    const distinctDomains = Boolean(rowDomain && otherDomain && rowDomain !== otherDomain);
    const distinctContent = /^[a-f0-9]{64}$/i.test(row.document.contentHash) && /^[a-f0-9]{64}$/i.test(other.document.contentHash) && row.document.contentHash.toLowerCase() !== other.document.contentHash.toLowerCase();
    const rowExcerptHash = createHash9("sha256").update(normalized2(row.match.excerpt)).digest("hex");
    const otherExcerptHash = createHash9("sha256").update(normalized2(other.match.excerpt)).digest("hex");
    return distinctDomains && distinctContent && rowExcerptHash !== otherExcerptHash;
  };
  const pressRowCorroborated = (row, rows) => pressRowEligible(row) && rows.some((other) => other !== row && pressRowEligible(other) && independentPressPair(row, other));
  const pressGroupCorroborated = (rows) => rows.some((row) => pressRowCorroborated(row, rows));
  const preliminaryPressConfirmation = new Map(
    [...groups].map(([claimKey, rows]) => [claimKey, pressGroupCorroborated(rows)])
  );
  const latestAumByEntity = /* @__PURE__ */ new Map();
  const conflictEligibleAum = supported.filter((candidate) => isAumMetric2(candidate.match.metric) && candidate.match.asOf && baseRowEligibleForConfirmation(candidate) && (candidate.sourceClass === "first_party_subject" || candidate.sourceClass === "first_party_investor" || candidate.sourceClass === "public_primary" || candidate.sourceClass === "independent_press" && preliminaryPressConfirmation.get(candidate.claimKey) === true));
  for (const row of conflictEligibleAum) {
    const entityKey = compact2(row.entity.name);
    const timestamp = new Date(row.match.asOf).getTime();
    latestAumByEntity.set(entityKey, Math.max(latestAumByEntity.get(entityKey) ?? 0, timestamp));
  }
  const conflictingAumEntities = /* @__PURE__ */ new Set();
  for (const [entityKey, latest] of latestAumByEntity) {
    const newestAmounts = conflictEligibleAum.filter((row) => compact2(row.entity.name) === entityKey && row.match.asOf && latest - new Date(row.match.asOf).getTime() <= AUM_CORROBORATION_WINDOW_MS2).map((row) => row.match.amountUsd);
    const materiallyConflicting = newestAmounts.some((amount, index) => newestAmounts.slice(index + 1).some((other) => !amountAgreement(amount, other, AUM_AMOUNT_TOLERANCE)));
    if (materiallyConflicting) conflictingAumEntities.add(entityKey);
  }
  const rowEligibleForConfirmation = (row) => {
    if (!baseRowEligibleForConfirmation(row)) return false;
    if (!isAumMetric2(row.match.metric)) return true;
    if (!row.match.asOf) return false;
    const entityKey = compact2(row.entity.name);
    const latest = latestAumByEntity.get(entityKey);
    return latest !== void 0 && latest - new Date(row.match.asOf).getTime() <= AUM_CORROBORATION_WINDOW_MS2 && !conflictingAumEntities.has(entityKey);
  };
  const confirmations = /* @__PURE__ */ new Map();
  const confirmedClaims = /* @__PURE__ */ new Set();
  for (const [claimKey, rows] of groups) {
    const eligible = rows.filter(rowEligibleForConfirmation);
    const authoritative = eligible.some((row) => row.sourceClass === "first_party_subject" || row.sourceClass === "first_party_investor" || row.sourceClass === "public_primary");
    const pressConfirmed = pressGroupCorroborated(eligible);
    const confirmed = authoritative || pressConfirmed;
    const sourceCount = new Set(eligible.filter((row) => row.sourceClass !== "other_public").map((row) => row.document.url)).size;
    confirmations.set(claimKey, { confirmed, pressConfirmed, sourceCount });
    if (confirmed) confirmedClaims.add(claimKey);
  }
  for (const row of supported) {
    const confirmation = confirmations.get(row.claimKey);
    const acceptedClass = row.sourceClass === "first_party_subject" || row.sourceClass === "first_party_investor" || row.sourceClass === "public_primary" || row.sourceClass === "independent_press";
    const confirmationThreshold = row.sourceClass === "independent_press" ? pressRowCorroborated(row, (groups.get(row.claimKey) ?? []).filter(rowEligibleForConfirmation)) : confirmation?.confirmed;
    const sourceConfirmed = Boolean(confirmationThreshold && rowEligibleForConfirmation(row) && acceptedClass);
    const basis = row.sourceClass === "public_primary" ? "regulatory" : row.sourceClass === "first_party_subject" || row.sourceClass === "first_party_investor" ? "manager_reported" : row.sourceClass === "independent_press" && sourceConfirmed ? "press_corroborated" : void 0;
    const unhashed = {
      kind: "fund_scale",
      provider: "fund-scale-web",
      title: `${row.entity.name} ${row.match.metric.replace(/_/g, " ")} ${amountLabel(row.match.amountUsd)}`,
      sourceUrl: row.document.url,
      capturedAt: row.document.capturedAt,
      sourceContentHash: row.document.contentHash,
      excerpt: row.match.excerpt,
      match: sourceConfirmed ? "fund_scale_confirmed" : "candidate",
      subjectName: ctx.evidence.profile.resolved_name || ctx.evidence.profile.display_name || ctx.handle,
      subjectHandle: row.entity.subjectHandle ?? ctx.handle,
      investorEntityName: row.entity.name,
      ...row.entity.handle && (row.entity.handleTrusted || row.officialInvestorDomain) ? { investorEntityHandle: row.entity.handle } : {},
      ...row.officialInvestorDomain ? { investorEntityDomain: row.officialInvestorDomain } : {},
      ...row.investorDomainProof ? {
        investorDomainSourceUrl: row.investorDomainProof.sourceUrl,
        investorDomainSourceContentHash: row.investorDomainProof.sourceContentHash,
        investorDomainCapturedAt: row.investorDomainProof.capturedAt,
        investorDomainSourceKind: row.investorDomainProof.sourceKind,
        investorDomainProfileName: row.investorDomainProof.profileName,
        investorDomainProfileWebsite: row.investorDomainProof.profileWebsite
      } : {},
      attribution: row.entity.attribution,
      ...row.entity.attributionSourceUrl ? { attributionSourceUrl: row.entity.attributionSourceUrl } : {},
      ...row.entity.attributionSourceContentHash ? { attributionSourceContentHash: row.entity.attributionSourceContentHash } : {},
      ...row.entity.attributionCapturedAt ? { attributionCapturedAt: row.entity.attributionCapturedAt } : {},
      ...row.entity.attributionSourceKind ? { attributionSourceKind: row.entity.attributionSourceKind } : {},
      sourceClass: row.sourceClass,
      fundName: row.entity.name,
      fundSizeUsd: row.match.amountUsd,
      ...row.match.fundVehicle ? { fundVehicle: row.match.fundVehicle } : {},
      fundScaleMetric: row.match.metric,
      fundAmountQualifier: row.match.qualifier,
      ...basis ? { fundScaleBasis: basis } : {},
      ...row.match.asOf ? { fundScaleAsOf: row.match.asOf } : {},
      ...row.match.publishedAt ? { publishedAt: row.match.publishedAt } : {},
      fundScaleTemporalState: row.match.temporalState,
      fundScaleSourceCount: confirmation?.sourceCount ?? 0,
      fundScaleClaimId: row.claimKey
    };
    const artifact = { ...unhashed, contentHash: artifactHash2(unhashed) };
    const exists = ctx.evidence.sourceArtifacts.some(
      (candidate) => candidate.kind === "fund_scale" && candidate.fundScaleClaimId === artifact.fundScaleClaimId && candidate.fundScaleMetric === artifact.fundScaleMetric && candidate.sourceUrl === artifact.sourceUrl
    );
    if (!exists) ctx.evidence.sourceArtifacts.push(artifact);
  }
  const reportedClaims = [...groups.keys()].filter((key) => !confirmedClaims.has(key)).length;
  const incomplete = unattributed + sourceLess + failed;
  if (confirmedClaims.size > 0 && incomplete > 0) {
    ctx.emit({
      phase: "Investor",
      label: "Fund scale verification partial",
      detail: `${confirmedClaims.size} scale claim${confirmedClaims.size === 1 ? "" : "s"} verified, but ${incomplete} candidate disposition${incomplete === 1 ? " remains" : "s remain"} incomplete.`,
      source: "fund-scale-web",
      tone: "warn"
    });
    return { state: "partial", detail: `${confirmedClaims.size} verified \xB7 ${reportedClaims} reported \xB7 ${incomplete} incomplete` };
  }
  if (confirmedClaims.size > 0) {
    ctx.emit({
      phase: "Investor",
      label: "Fund scale verified",
      detail: `${confirmedClaims.size} source-fetched scale claim${confirmedClaims.size === 1 ? "" : "s"} passed the deterministic confirmation threshold.`,
      source: "fund-scale-web",
      tone: "good"
    });
    return { state: "executed", detail: `${confirmedClaims.size} verified \xB7 ${reportedClaims} reported` };
  }
  if (!inspections.length || incomplete > 0) {
    return {
      state: successfulFetches ? "partial" : "failed",
      detail: `${successfulFetches} fetched \xB7 ${incomplete} incomplete \xB7 0 verified`
    };
  }
  ctx.emit({
    phase: "Investor",
    label: "Fund scale not verified",
    detail: "Cited pages were inspected, but no current AUM or completed fund-size claim met the confirmation threshold.",
    source: "fund-scale-web",
    tone: "warn"
  });
  return { state: "partial", detail: `${successfulFetches} sources inspected \xB7 ${reportedClaims} reported \xB7 0 verified` };
}

// server/adapters/projectToken.ts
var COINGECKO_PUBLIC = "https://api.coingecko.com/api/v3";
var COINGECKO_PRO = "https://pro-api.coingecko.com/api/v3";
var DEXSCREENER = "https://api.dexscreener.com/latest/dex/tokens";
var GECKOTERMINAL = "https://api.geckoterminal.com/api/v2";
var MAX_CANDIDATES3 = 3;
var MAX_HISTORY_POINTS = 90;
var PRICE_TOLERANCE = 0.25;
var MIN_POOL_LIQUIDITY_USD = 25e3;
var EVM_ADDRESS2 = /^0x[a-fA-F0-9]{40}$/;
var SOLANA_ADDRESS2 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
var PLATFORM_CHAIN = {
  solana: "solana",
  ethereum: "ethereum",
  base: "base",
  "arbitrum-one": "arbitrum",
  "binance-smart-chain": "bsc",
  "polygon-pos": "polygon",
  "optimistic-ethereum": "optimism",
  avalanche: "avalanche"
};
var GECKOTERMINAL_NETWORK = {
  solana: "solana",
  ethereum: "eth",
  base: "base",
  arbitrum: "arbitrum",
  bsc: "bsc",
  polygon: "polygon_pos",
  optimism: "optimism",
  avalanche: "avax"
};
var geckoTerminalOhlcvUrl = (chain, poolAddress, timeframe) => {
  const network = GECKOTERMINAL_NETWORK[chain];
  return network ? `${GECKOTERMINAL}/networks/${encodeURIComponent(network)}/pools/${encodeURIComponent(poolAddress)}/ohlcv/${timeframe}?aggregate=1&limit=${MAX_HISTORY_POINTS}&currency=usd` : null;
};
var isRecord3 = (value) => !!value && typeof value === "object" && !Array.isArray(value);
var finiteNumber = (value) => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : void 0;
};
var cleanText = (value) => typeof value === "string" ? value.trim() : "";
var normalized3 = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");
var projectName = (value) => value.split(/\s*(?:\||:|\u2013|\u2014|\u00b7)\s*/)[0]?.trim() || value.trim();
var normalizeHandle2 = (value) => value.trim().replace(/^@/, "").toLowerCase();
var sameAddress = (left, right) => left.toLowerCase() === right.toLowerCase();
var coingeckoConfig = () => {
  const key = env("COINGECKO_API_KEY");
  return {
    base: key ? COINGECKO_PRO : COINGECKO_PUBLIC,
    headers: key ? { "x-cg-pro-api-key": key } : {},
    tier: key ? "subscription/keyed" : "keyless"
  };
};
async function coinSearch(query) {
  const { base, headers: headers4, tier } = coingeckoConfig();
  let response;
  try {
    response = await fetch(`${base}/search?query=${encodeURIComponent(query)}`, {
      headers: headers4,
      signal: AbortSignal.timeout(1e4)
    });
  } catch {
    recordCall("coingecko", "project-search", 0, `${tier} \xB7 transport_error`, "failed");
    return null;
  }
  if (!response.ok) {
    recordCall("coingecko", "project-search", 0, `${tier} \xB7 http_${response.status}`, "failed");
    return null;
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    recordCall("coingecko", "project-search", 0, `${tier} \xB7 response_json_error`, "failed");
    return null;
  }
  const rows = isRecord3(payload) && Array.isArray(payload.coins) ? payload.coins : null;
  if (!rows) {
    recordCall("coingecko", "project-search", 0, `${tier} \xB7 result_shape_error`, "partial");
    return null;
  }
  const valid = rows.flatMap((candidate) => {
    if (!isRecord3(candidate)) return [];
    const id = cleanText(candidate.id);
    const name = cleanText(candidate.name);
    const symbol = cleanText(candidate.symbol);
    if (!id || !name) return [];
    return [{
      id,
      name,
      symbol,
      rank: Number.isFinite(candidate.market_cap_rank) ? Number(candidate.market_cap_rank) : null
    }];
  });
  recordCall(
    "coingecko",
    "project-search",
    0,
    `${tier} \xB7 ${valid.length ? `${valid.length} candidates` : "no_candidates"}`,
    valid.length === rows.length ? "succeeded" : "partial"
  );
  return valid;
}
function rankedCandidates(query, rows) {
  const cleanQuery = projectName(query);
  const queryKey = normalized3(cleanQuery);
  const queryWords = cleanQuery.toLowerCase().split(/\s+/).filter((word) => word.length >= 3);
  const score = (row) => {
    const nameKey = normalized3(row.name);
    const symbolKey = normalized3(row.symbol);
    let value = 0;
    if (nameKey === queryKey) value += 1e3;
    else if (nameKey && queryKey && (nameKey.includes(queryKey) || queryKey.includes(nameKey))) value += 600;
    value += queryWords.filter((word) => row.name.toLowerCase().includes(word)).length * 80;
    if (symbolKey && symbolKey === queryKey) value += 500;
    if (row.rank != null) value += Math.max(0, 200 - Math.min(row.rank, 200));
    return value;
  };
  return rows.map((row) => ({ row, relevance: score(row) })).filter(({ relevance }) => relevance >= 500).sort((left, right) => right.relevance - left.relevance || (left.row.rank ?? Number.MAX_SAFE_INTEGER) - (right.row.rank ?? Number.MAX_SAFE_INTEGER)).slice(0, MAX_CANDIDATES3).map(({ row }) => row);
}
async function coinDetails(id) {
  const { base, headers: headers4, tier } = coingeckoConfig();
  const url = `${base}/coins/${encodeURIComponent(id)}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`;
  let response;
  try {
    response = await fetch(url, { headers: headers4, signal: AbortSignal.timeout(1e4) });
  } catch {
    recordCall("coingecko", "project-details", 0, `${tier} \xB7 transport_error`, "failed");
    return null;
  }
  if (!response.ok) {
    recordCall("coingecko", "project-details", 0, `${tier} \xB7 http_${response.status}`, "failed");
    return null;
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    recordCall("coingecko", "project-details", 0, `${tier} \xB7 response_json_error`, "failed");
    return null;
  }
  if (!isRecord3(payload)) {
    recordCall("coingecko", "project-details", 0, `${tier} \xB7 result_shape_error`, "partial");
    return null;
  }
  recordCall("coingecko", "project-details", 0, `${tier} \xB7 ${id}`, "succeeded");
  return payload;
}
var validContract = (platform, value) => {
  const address = cleanText(value);
  if (!address) return null;
  if (platform === "solana") return SOLANA_ADDRESS2.test(address) ? address : null;
  return PLATFORM_CHAIN[platform] && EVM_ADDRESS2.test(address) ? address : null;
};
function canonicalContract(details) {
  const platforms = isRecord3(details.platforms) ? details.platforms : {};
  const native = cleanText(details.asset_platform_id);
  const order = [...new Set([
    native,
    "solana",
    "ethereum",
    "base",
    "arbitrum-one",
    "binance-smart-chain",
    "polygon-pos",
    "optimistic-ethereum",
    "avalanche"
  ].filter(Boolean))];
  for (const platform of order) {
    const address = validContract(platform, platforms[platform]);
    const chain = PLATFORM_CHAIN[platform];
    if (address && chain) return { address, chain };
  }
  return null;
}
var officialHomepages = (details) => {
  const links = isRecord3(details.links) ? details.links : {};
  const homes = Array.isArray(links.homepage) ? links.homepage : [];
  return homes.filter(
    (value) => typeof value === "string" && canonicalOfficialWebsite(value) !== null
  );
};
var domainsMatch = (left, right) => left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`);
function verifyIdentity(ctx, details) {
  const links = isRecord3(details.links) ? details.links : {};
  const officialHandle = cleanText(links.twitter_screen_name);
  const exactX = officialHandle && normalizeHandle2(officialHandle) === normalizeHandle2(ctx.handle);
  const homepages = officialHomepages(details);
  if (exactX) {
    return {
      verification: "official_x",
      ...homepages[0] ? { homepage: homepages[0] } : {},
      officialX: `@${officialHandle.replace(/^@/, "")}`
    };
  }
  const profile = ctx.evidence.profile;
  const capturedAt = Date.parse(profile.profile_captured_at ?? "");
  const profileScope = profile.profile_collection_state === "resolved" && profile.profile_provider === "twitterapi" && Number.isFinite(capturedAt) ? canonicalOfficialWebsite(profile.website) : null;
  const homepage = profileScope ? homepages.find((candidate) => {
    const tokenScope = canonicalOfficialWebsite(candidate);
    return tokenScope !== null && domainsMatch(profileScope.domain, tokenScope.domain);
  }) : void 0;
  if (!profileScope || !homepage) return null;
  return {
    verification: "official_domain",
    homepage,
    ...officialHandle ? { officialX: `@${officialHandle.replace(/^@/, "")}` } : {}
  };
}
async function dexPairs(address) {
  let response;
  try {
    response = await fetch(`${DEXSCREENER}/${encodeURIComponent(address)}`, {
      signal: AbortSignal.timeout(8e3)
    });
  } catch {
    recordCall("dexscreener", "project-token-pairs", 0, "keyless \xB7 transport_error", "failed");
    return null;
  }
  if (!response.ok) {
    recordCall("dexscreener", "project-token-pairs", 0, `keyless \xB7 http_${response.status}`, "failed");
    return null;
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    recordCall("dexscreener", "project-token-pairs", 0, "keyless \xB7 response_json_error", "failed");
    return null;
  }
  if (!isRecord3(payload) || !Array.isArray(payload.pairs)) {
    recordCall("dexscreener", "project-token-pairs", 0, "keyless \xB7 result_shape_error", "partial");
    return null;
  }
  const pairs = payload.pairs.filter(isRecord3);
  recordCall(
    "dexscreener",
    "project-token-pairs",
    0,
    `keyless \xB7 ${pairs.length ? `${pairs.length} pairs` : "no_pairs"}`,
    pairs.length === payload.pairs.length ? "succeeded" : "partial"
  );
  return pairs;
}
var quotePriority = (symbol) => {
  switch (symbol.toUpperCase()) {
    case "USDC":
    case "USDT":
    case "SOL":
    case "WSOL":
    case "ETH":
    case "WETH":
      return 1;
    default:
      return 0;
  }
};
function selectPriceCorroboratedPair(rows, token, coingeckoPrice) {
  if (!coingeckoPrice || coingeckoPrice <= 0) return null;
  const candidates = rows.flatMap((row) => {
    const baseToken = isRecord3(row.baseToken) ? row.baseToken : {};
    const quoteToken = isRecord3(row.quoteToken) ? row.quoteToken : {};
    const baseAddress = cleanText(baseToken.address);
    const chain = cleanText(row.chainId).toLowerCase();
    const priceUsd = finiteNumber(row.priceUsd);
    const pairAddress = cleanText(row.pairAddress);
    if (!baseAddress || !sameAddress(baseAddress, token.address) || chain !== token.chain || !priceUsd || priceUsd <= 0 || !pairAddress) return [];
    const difference = Math.abs(priceUsd - coingeckoPrice) / coingeckoPrice;
    if (difference > PRICE_TOLERANCE) return [];
    const liquidity = isRecord3(row.liquidity) ? finiteNumber(row.liquidity.usd) : void 0;
    if (liquidity == null || liquidity < MIN_POOL_LIQUIDITY_USD) return [];
    return [{
      pairAddress,
      chain,
      quoteSymbol: cleanText(quoteToken.symbol),
      priceUsd,
      liquidityUsd: liquidity
    }];
  });
  return candidates.sort(
    (left, right) => right.liquidityUsd - left.liquidityUsd || quotePriority(right.quoteSymbol) - quotePriority(left.quoteSymbol)
  )[0] ?? null;
}
async function ohlcv(chain, poolAddress, timeframe) {
  const url = geckoTerminalOhlcvUrl(chain, poolAddress, timeframe);
  if (!url) return null;
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(8e3) });
  } catch {
    recordCall("geckoterminal", `project-token-ohlcv-${timeframe}`, 0, "keyless \xB7 transport_error", "failed");
    return null;
  }
  if (!response.ok) {
    recordCall("geckoterminal", `project-token-ohlcv-${timeframe}`, 0, `keyless \xB7 http_${response.status}`, "failed");
    return null;
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    recordCall("geckoterminal", `project-token-ohlcv-${timeframe}`, 0, "keyless \xB7 response_json_error", "failed");
    return null;
  }
  const data = isRecord3(payload) && isRecord3(payload.data) ? payload.data : null;
  const attributes = data && isRecord3(data.attributes) ? data.attributes : null;
  const rows = attributes && Array.isArray(attributes.ohlcv_list) ? attributes.ohlcv_list : null;
  if (!rows) {
    recordCall("geckoterminal", `project-token-ohlcv-${timeframe}`, 0, "keyless \xB7 result_shape_error", "partial");
    return null;
  }
  const valid = rows.filter(
    (row) => Array.isArray(row) && row.length >= 6 && row.slice(0, 6).every((value) => typeof value === "number" && Number.isFinite(value))
  ).slice(0, MAX_HISTORY_POINTS);
  recordCall(
    "geckoterminal",
    `project-token-ohlcv-${timeframe}`,
    0,
    `keyless \xB7 ${valid.length ? `${valid.length} points` : "no_points"}`,
    valid.length === rows.length ? "succeeded" : "partial"
  );
  return valid;
}
async function tokenHistory(chain, poolAddress) {
  let timeframe = "day";
  let attempts = 1;
  let rows = await ohlcv(chain, poolAddress, timeframe);
  if (!rows?.length) {
    timeframe = "hour";
    attempts += 1;
    rows = await ohlcv(chain, poolAddress, timeframe);
  }
  if (!rows?.length) return { attempts };
  const chronological = [...rows].sort((left, right) => left[0] - right[0]);
  const points = chronological.map((row) => row[4]).filter((value) => Number.isFinite(value) && value > 0);
  if (!points.length) return { attempts };
  const first = points[0];
  const last = points[points.length - 1];
  const peak = Math.max(...points);
  return {
    attempts,
    history: {
      points,
      first,
      last,
      peak,
      changePct: first > 0 ? (last - first) / first * 100 : 0,
      drawdownPct: peak > 0 ? (last - peak) / peak * 100 : 0,
      timeframe,
      poolAddress,
      ...geckoTerminalOhlcvUrl(chain, poolAddress, timeframe) ? {
        sourceUrl: geckoTerminalOhlcvUrl(chain, poolAddress, timeframe)
      } : {}
    }
  };
}
async function collectProjectTokenIdentity(ctx) {
  const query = projectName(ctx.evidence.profile.display_name || ctx.handle.replace(/^@/, ""));
  if (query.length < 2) return { state: "skipped", detail: "project display name unavailable", attempts: 0 };
  const search = await coinSearch(query);
  if (!search) return { state: "failed", detail: "CoinGecko project search failed", attempts: 1 };
  const candidates = rankedCandidates(query, search);
  if (!candidates.length) return { state: "executed", detail: "CoinGecko returned no project-token candidates", attempts: 1 };
  const detailAttempts = candidates.length;
  const inspected = await Promise.all(candidates.map(async (candidate) => {
    const details2 = await coinDetails(candidate.id);
    if (!details2) return null;
    const identity2 = verifyIdentity(ctx, details2);
    const contract2 = canonicalContract(details2);
    if (identity2 && contract2) {
      return { details: details2, identity: identity2, contract: contract2 };
    }
    return null;
  }));
  const selected = inspected.find((candidate) => candidate !== null) ?? null;
  if (!selected?.identity) {
    return {
      state: "executed",
      detail: "CoinGecko candidates did not match the official X account or profile domain",
      attempts: 1 + detailAttempts
    };
  }
  const { details, identity, contract } = selected;
  const market = isRecord3(details.market_data) ? details.market_data : {};
  const currentPrice = isRecord3(market.current_price) ? finiteNumber(market.current_price.usd) : void 0;
  const marketCap = isRecord3(market.market_cap) ? finiteNumber(market.market_cap.usd) : void 0;
  const fdv = isRecord3(market.fully_diluted_valuation) ? finiteNumber(market.fully_diluted_valuation.usd) : void 0;
  const volume = isRecord3(market.total_volume) ? finiteNumber(market.total_volume.usd) : void 0;
  const circulatingSupply = finiteNumber(market.circulating_supply);
  const totalSupply = finiteNumber(market.total_supply);
  const maxSupply = finiteNumber(market.max_supply);
  const id = cleanText(details.id);
  const name = cleanText(details.name);
  const symbol = cleanText(details.symbol).toUpperCase();
  if (!id || !name || !symbol) {
    return { state: "partial", detail: "verified CoinGecko identity had incomplete token metadata", attempts: 1 + detailAttempts };
  }
  const pairs = await dexPairs(contract.address);
  const pair = pairs ? selectPriceCorroboratedPair(pairs, contract, currentPrice) : null;
  const historyResult = pair ? await tokenHistory(contract.chain, pair.pairAddress) : { attempts: 0 };
  const history = historyResult.history;
  const snapshot = {
    verified: true,
    verification: identity.verification,
    name,
    symbol,
    coingeckoId: id,
    rank: Number.isFinite(details.market_cap_rank) ? Number(details.market_cap_rank) : null,
    address: contract.address,
    chain: contract.chain,
    ...identity.homepage ? { homepage: identity.homepage } : {},
    ...identity.officialX ? { officialX: identity.officialX } : {},
    sourceUrl: `https://www.coingecko.com/en/coins/${encodeURIComponent(id)}`,
    capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
    providers: ["coingecko", ...pair ? ["dexscreener"] : [], ...history ? ["geckoterminal"] : []],
    ...currentPrice !== void 0 ? { priceUsd: currentPrice } : {},
    ...marketCap !== void 0 ? { marketCapUsd: marketCap } : {},
    ...fdv !== void 0 ? { fdvUsd: fdv } : {},
    ...volume !== void 0 ? { volume24hUsd: volume } : {},
    ...circulatingSupply !== void 0 ? { circulatingSupply } : {},
    ...totalSupply !== void 0 ? { totalSupply } : {},
    ...maxSupply !== void 0 ? { maxSupply } : {},
    ...pair ? { liquidityUsd: pair.liquidityUsd, pairAddress: pair.pairAddress } : {},
    ...history ? { history } : {}
  };
  ctx.evidence.projectToken = snapshot;
  if (!canonicalOfficialWebsite(ctx.evidence.profile.website) && snapshot.homepage) {
    ctx.evidence.profile.website = snapshot.homepage;
  }
  ctx.recordCheck?.({
    id: "project-token-identity",
    status: "confirmed",
    note: `$${snapshot.symbol} matched this project through its ${snapshot.verification === "official_x" ? "official X account" : "official website domain"} and canonical ${snapshot.chain} contract`,
    provider: "coingecko",
    sourceCount: 1
  });
  if (pair) {
    ctx.recordCheck?.({
      id: "project-traction-liveness",
      status: "confirmed",
      note: `$${snapshot.symbol} has a price-corroborated DEX pool with $${Math.round(pair.liquidityUsd).toLocaleString()} liquidity${history ? ` and ${history.points.length} frozen ${history.timeframe} price points` : ""}`,
      provider: history ? "dexscreener/geckoterminal" : "dexscreener",
      sourceCount: history ? 2 : 1
    });
  }
  ctx.emit({
    phase: "P0 \xB7 Routing",
    label: `Official token resolved \xB7 $${snapshot.symbol}`,
    detail: `${snapshot.name} matched by ${snapshot.verification === "official_x" ? "official X account" : "official domain"}${pair ? `; price corroborated on a $${Math.round(pair.liquidityUsd).toLocaleString()} liquidity pool` : "; no DEX pool passed price corroboration"}.`,
    source: "coingecko / dexscreener",
    tone: "good"
  });
  return {
    state: pairs === null ? "partial" : "executed",
    detail: `verified $${snapshot.symbol} by ${snapshot.verification}${pair ? " with a price-corroborated DEX pair" : " without a price-corroborated DEX pair"}`,
    attempts: 1 + detailAttempts + 1 + historyResult.attempts
  };
}
async function collectVentureTokenIdentity(venture) {
  const query = projectName(venture.name);
  const ventureHandle = venture.xHandle?.trim() ? normalizeHandle2(venture.xHandle) : null;
  const ventureScope = venture.domain?.trim() ? canonicalOfficialWebsite(venture.domain) : null;
  if (query.length < 2 || !ventureHandle && !ventureScope) return null;
  const search = await coinSearch(query);
  if (!search) return null;
  const candidates = rankedCandidates(query, search);
  for (const candidate of candidates) {
    const details = await coinDetails(candidate.id);
    if (!details) continue;
    const links = isRecord3(details.links) ? details.links : {};
    const officialHandle = cleanText(links.twitter_screen_name);
    const exactX = Boolean(ventureHandle && officialHandle && normalizeHandle2(officialHandle) === ventureHandle);
    const homepages = officialHomepages(details);
    const domainHomepage = ventureScope ? homepages.find((candidateHome) => {
      const tokenScope = canonicalOfficialWebsite(candidateHome);
      return tokenScope !== null && domainsMatch(ventureScope.domain, tokenScope.domain);
    }) : void 0;
    if (!exactX && !domainHomepage) continue;
    const contract = canonicalContract(details);
    if (!contract) continue;
    const id = cleanText(details.id);
    const name = cleanText(details.name);
    const symbol = cleanText(details.symbol).toUpperCase();
    if (!id || !name || !symbol) continue;
    const market = isRecord3(details.market_data) ? details.market_data : {};
    const currentPrice = isRecord3(market.current_price) ? finiteNumber(market.current_price.usd) : void 0;
    const marketCap = isRecord3(market.market_cap) ? finiteNumber(market.market_cap.usd) : void 0;
    return {
      verified: true,
      verification: exactX ? "official_x" : "official_domain",
      ventureName: venture.name,
      name,
      symbol,
      coingeckoId: id,
      rank: Number.isFinite(details.market_cap_rank) ? Number(details.market_cap_rank) : null,
      address: contract.address,
      chain: contract.chain,
      ...homepages[0] ? { homepage: homepages[0] } : {},
      ...officialHandle ? { officialX: `@${officialHandle.replace(/^@/, "")}` } : {},
      sourceUrl: `https://www.coingecko.com/en/coins/${encodeURIComponent(id)}`,
      capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
      providers: ["coingecko"],
      ...currentPrice !== void 0 ? { priceUsd: currentPrice } : {},
      ...marketCap !== void 0 ? { marketCapUsd: marketCap } : {}
    };
  }
  return null;
}

// server/basicFactsProjection.ts
import { createHash as createHash10 } from "node:crypto";
var CRITICAL = /* @__PURE__ */ new Set([
  "official_identity",
  "current_role",
  "product",
  "founder",
  "executive",
  "official_token"
]);
var FOUNDER_ROLE = /\b(?:co[- ]?)?founder\b|\bcreator\b/i;
var CURRENT_AUTHORITY_ROLE = /\b(?:co[- ]?)?founder\b|\b(?:chief\s+executive\s+officer|ceo|chair(?:man|woman)?|president|owner|managing\s+partner|general\s+partner|director|head|lead)\b/i;
var normalizeValue = (value) => value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9@$.'-]+/g, " ").replace(/\s+/g, " ").trim();
var normalizeFactValue = (predicate, value) => canonicalBasicFactComparisonValue(predicate, normalizeValue(value));
var hash2 = (value) => createHash10("sha256").update(JSON.stringify(value)).digest("hex");
function factId2(subjectKey, predicate, value) {
  return `basic_v1_${hash2(`${subjectKey.toLowerCase()}::${predicate}::${normalizeFactValue(predicate, value)}`)}`;
}
function officialHost(evidence) {
  try {
    return evidence.profile.website ? new URL(evidence.profile.website).hostname.replace(/^www\./, "").toLowerCase() : null;
  } catch {
    return null;
  }
}
function isOfficialUrl(url, host) {
  if (!host) return false;
  try {
    const candidate = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return candidate === host || candidate.endsWith(`.${host}`);
  } catch {
    return false;
  }
}
function safePublicUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:" || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}
function containsPhrase(text2, phrase) {
  const phraseValue = (value) => normalizeValue(value).replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  const haystack = ` ${phraseValue(text2)} `;
  const needle = phraseValue(phrase);
  return Boolean(needle) && haystack.includes(` ${needle} `);
}
function sourceHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}
var VENTURE_HOST_STOP_WORDS = /* @__PURE__ */ new Set([
  "company",
  "foundation",
  "global",
  "group",
  "holdings",
  "labs",
  "limited",
  "network",
  "project",
  "protocol",
  "technologies",
  "technology",
  "the"
]);
function hostIdentifiesVenture(host, projectName2) {
  const labels = host.split(".").map((label) => label.replace(/[^a-z0-9]/g, ""));
  const tokens = normalizeValue(projectName2).replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((token) => token.length >= 4 && !VENTURE_HOST_STOP_WORDS.has(token));
  return tokens.some((token) => labels.includes(token));
}
function verifiedVentureHosts(venture) {
  const hosts = [];
  const domain = safePublicUrl(venture.domain?.includes("://") ? venture.domain : venture.domain ? `https://${venture.domain}` : null);
  const domainHost = domain ? sourceHost(domain) : null;
  if (domainHost) hosts.push(domainHost);
  const evidenceUrl = safePublicUrl(venture.evidence_url);
  const evidenceHost = evidenceUrl ? sourceHost(evidenceUrl) : null;
  if (evidenceHost && hostIdentifiesVenture(evidenceHost, venture.project_name)) hosts.push(evidenceHost);
  return [...new Set(hosts)];
}
function sourceMatchesVenture(candidate, venture) {
  const host = sourceHost(candidate.url);
  if (!host) return false;
  if (venture.domain) {
    const ventureUrl = safePublicUrl(venture.domain.includes("://") ? venture.domain : `https://${venture.domain}`);
    const ventureHost = ventureUrl ? sourceHost(ventureUrl) : null;
    if (ventureHost && (host === ventureHost || host.endsWith(`.${ventureHost}`))) return true;
  }
  return verifiedVentureHosts(venture).some((ventureHost) => host === ventureHost || host.endsWith(`.${ventureHost}`));
}
var MATERIAL_AUTHORITY_ROLES = [
  { claimed: /\b(?:co[- ]?)?founder\b|\bcreator\b/i, supportedPattern: "(?:co[- ]?founder|founder|creator)" },
  { claimed: /\b(?:chief\s+executive\s+officer|ceo)\b/i, supportedPattern: "(?:chief\\s+executive\\s+officer|ceo)" },
  { claimed: /\bchair(?:man|woman|person)?\b/i, supportedPattern: "chair(?:man|woman|person)?" },
  { claimed: /\bpresident\b/i, supportedPattern: "president" },
  { claimed: /\bowner\b/i, supportedPattern: "owner" },
  { claimed: /\bmanaging\s+partner\b/i, supportedPattern: "managing\\s+partner" },
  { claimed: /\bgeneral\s+partner\b/i, supportedPattern: "general\\s+partner" },
  { claimed: /\bdirector\b/i, supportedPattern: "director" },
  { claimed: /\bhead\b/i, supportedPattern: "head" },
  { claimed: /\blead\b/i, supportedPattern: "lead" }
];
function passageBindsSpecificAuthorityRole(passage, aliases, venture, rolePattern) {
  const venturePattern = escapePattern(venture.project_name.trim()).replace(/\s+/g, "\\s+");
  const anyAuthorityRole = "(?:co[- ]?founder|founder|creator|chief\\s+executive\\s+officer|ceo|chair(?:man|woman|person)?|president|owner|managing\\s+partner|general\\s+partner|director|head|lead)";
  const roleConnector = `(?:(?:${anyAuthorityRole})\\s*(?:,|&|and)\\s*|(?:has\\s+served|serves?|served|serving)\\s+(?:as\\s+)?(?:(?:the|a|an|our)\\s+)?)`;
  return aliases.some((alias) => {
    const aliasPattern = escapePattern(alias).replace(/\s+/g, "\\s+");
    const subjectFirst = new RegExp(
      `\\b${aliasPattern}\\b\\s*(?:,\\s*)?(?:(?:is|was|remains|became|serves?|served|serving|has\\s+served|currently\\s+serves?)\\s+(?:as\\s+)?(?:(?:the|a|an|our)\\s+)?)?(?:${venturePattern}\\s+)?(?:${roleConnector}){0,4}\\b${rolePattern}\\b`,
      "i"
    );
    const titleFirst = new RegExp(
      `\\b${rolePattern}\\s+(?:of|at)\\s+${venturePattern}\\s*,?\\s*${aliasPattern}\\b`,
      "i"
    );
    const foundedBy = /founder|creator/.test(rolePattern) && new RegExp(`\\b${venturePattern}\\s+(?:was\\s+)?(?:co[- ]?founded|founded|created)\\s+by\\s+${aliasPattern}\\b`, "i").test(passage);
    return subjectFirst.test(passage) || titleFirst.test(passage) || foundedBy;
  });
}
function currentRoleIsFullySupported(sources, venture, aliases) {
  const claimedRoles = MATERIAL_AUTHORITY_ROLES.filter(({ claimed }) => claimed.test(venture.role));
  if (!claimedRoles.length) return false;
  return claimedRoles.every(({ supportedPattern }) => sources.some((candidate) => {
    const sourceScopeMatches = sourceMatchesVenture(candidate, venture);
    return boundedSourcePassages(candidate.excerpt).some((passage) => passageBindsSpecificAuthorityRole(passage, aliases, venture, supportedPattern) && (containsPhrase(passage, venture.project_name) || sourceScopeMatches));
  }));
}
function sourceMentionsSubject(candidate, aliases) {
  return aliases.some((alias) => containsPhrase(candidate.excerpt, alias));
}
function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function boundedSourcePassages(value) {
  return value.split(/(?<=[.!?;])\s+|[\n|]+/).map((passage) => passage.trim()).filter(Boolean);
}
function passageBindsSubjectRole(passage, aliases, venture, predicate) {
  const venturePattern = escapePattern(venture.project_name.trim()).replace(/\s+/g, "\\s+");
  return aliases.some((alias) => {
    const aliasPattern = escapePattern(alias).replace(/\s+/g, "\\s+");
    if (predicate === "founder") {
      const founderRole = "(?:co[- ]?founder|founder|creator)";
      return new RegExp(
        `(?:\\b${aliasPattern}\\b\\s*(?:,\\s*)?(?:(?:is|was|remains|became|serves?|served|serving|has\\s+served)\\s+(?:as\\s+)?(?:(?:the|a|an|our)\\s+)?)?(?:${venturePattern}\\s+)?${founderRole}\\b)|(?:\\b${aliasPattern}\\b\\s+(?:co[- ]?founded|founded|created)\\s+(?:${venturePattern})\\b)|(?:\\b(?:${venturePattern}\\s+)?(?:co[- ]?founded|founded|created)\\s+by\\s+${aliasPattern}\\b)`,
        "i"
      ).test(passage);
    }
    const authorityRole = "(?:co[- ]?founder|founder|chief\\s+executive\\s+officer|ceo|chair(?:man|woman|person)?|president|owner|managing\\s+partner|general\\s+partner|director|head|lead)";
    return new RegExp(
      `(?:\\b${aliasPattern}\\b\\s*(?:,\\s*)?(?:(?:is|was|remains|became|serves?|served|serving|has\\s+served|currently\\s+serves?)\\s+(?:as\\s+)?(?:(?:the|a|an|our)\\s+)?)?(?:${venturePattern}\\s+)?${authorityRole}\\b)|(?:\\b${authorityRole}\\s+(?:of|at)\\s+${venturePattern}\\s*,?\\s*${aliasPattern}\\b)`,
      "i"
    ).test(passage);
  });
}
function sourceSupportsRelationship(candidate, venture, aliases, predicate) {
  if (!sourceMentionsSubject(candidate, aliases)) return false;
  const sourceScopeMatches = sourceMatchesVenture(candidate, venture);
  return boundedSourcePassages(candidate.excerpt).some((passage) => passageBindsSubjectRole(passage, aliases, venture, predicate) && (containsPhrase(passage, venture.project_name) || sourceScopeMatches));
}
function source(input) {
  return {
    ...input,
    relation: "supports",
    contentHash: hash2(input),
    artifactVerified: true
  };
}
function makeFact(evidence, predicate, value, sources, qualifier) {
  const subjectKey = evidence.profile.handle;
  return {
    factId: factId2(subjectKey, predicate, value),
    subjectKey,
    predicate,
    value,
    normalizedValue: normalizeFactValue(predicate, value),
    status: "verified",
    critical: CRITICAL.has(predicate),
    sources,
    ...qualifier ? { qualifier } : {},
    evidence_origin: "deterministic",
    artifact_verified: true,
    provider: "public-web"
  };
}
function profileSource(evidence, capturedAt) {
  const handle = evidence.profile.handle.replace(/^@/, "");
  return source({
    url: `https://x.com/${encodeURIComponent(handle)}`,
    title: "Official X profile",
    excerpt: evidence.profile.bio.trim() ? `${evidence.profile.display_name} (${evidence.profile.handle}): ${evidence.profile.bio.trim()}` : `${evidence.profile.display_name} (${evidence.profile.handle}) is the provider-resolved identity for this account.`,
    capturedAt,
    provider: "twitterapi",
    sourceClass: "official_subject"
  });
}
function githubIdentitySource(evidence, capturedAt) {
  if (!/links?\s+back\s+to\s+(?:this\s+)?X\s+handle/i.test(evidence.profile.identity_note)) return null;
  const login = evidence.profile.identity_note.match(/GitHub\s+github\.com\/([A-Za-z0-9_.-]+)/i)?.[1];
  if (!login) return null;
  return source({
    url: `https://github.com/${login}`,
    title: "Identity-bound GitHub profile",
    excerpt: evidence.profile.identity_note,
    capturedAt,
    provider: "github",
    sourceClass: "other_public"
  });
}
function profileSupportsVenture(evidence, venture, predicate) {
  const clauses = evidence.profile.bio.split(/[.;|\n]+/).filter((clause) => containsPhrase(clause, venture.project_name) || Boolean(venture.x_handle && containsPhrase(clause, venture.x_handle)));
  return clauses.some((clause) => predicate === "founder" ? FOUNDER_ROLE.test(clause) : CURRENT_AUTHORITY_ROLE.test(clause));
}
function mergeProjectedFact(evidence, fact) {
  const existing = evidence.basicFacts ?? (evidence.basicFacts = []);
  const same = existing.find(
    (candidate) => candidate.predicate === fact.predicate && candidate.normalizedValue === fact.normalizedValue
  );
  if (!same) {
    existing.push(fact);
    return fact;
  }
  const known = new Set(same.sources.map((candidate) => candidate.url));
  same.sources.push(...fact.sources.filter((candidate) => !known.has(candidate.url)));
  if (same.status !== "conflicted") same.status = "verified";
  return same;
}
function reconcileQuestionLedger(evidence, facts) {
  const singletonPredicates = /* @__PURE__ */ new Set(["official_identity"]);
  const projectedByPredicate = /* @__PURE__ */ new Map();
  for (const fact of facts) {
    if (fact.status !== "verified" && fact.status !== "corroborated") continue;
    const rows = projectedByPredicate.get(fact.predicate) ?? [];
    rows.push(fact);
    projectedByPredicate.set(fact.predicate, rows);
  }
  for (const entry of evidence.basicFactQuestionLedger ?? []) {
    const answers = projectedByPredicate.get(entry.predicate) ?? [];
    if (!answers.length) continue;
    if (singletonPredicates.has(entry.predicate)) {
      const allPredicateFacts = (evidence.basicFacts ?? []).filter((fact) => fact.predicate === entry.predicate);
      const acceptedValues = new Set(allPredicateFacts.filter((fact) => fact.status === "verified" || fact.status === "corroborated").map((fact) => fact.normalizedValue));
      if (allPredicateFacts.some((fact) => fact.status === "conflicted") || acceptedValues.size !== 1) continue;
    }
    entry.answerRefs = [.../* @__PURE__ */ new Set([...entry.answerRefs, ...answers.map((fact) => fact.factId)])];
    entry.status = "answered";
  }
}
function formatUsd(value) {
  const absolute = Math.abs(value);
  if (absolute >= 1e9) return `$${(value / 1e9).toFixed(absolute >= 1e10 ? 0 : 1)}B`;
  if (absolute >= 1e6) return `$${(value / 1e6).toFixed(absolute >= 1e7 ? 0 : 1)}M`;
  if (absolute >= 1e3) return `$${(value / 1e3).toFixed(absolute >= 1e4 ? 0 : 1)}K`;
  return `$${value.toFixed(2)}`;
}
function projectProviderBackedBasicFacts(evidence) {
  const projected = [];
  const capturedAt = evidence.profile.profile_captured_at ?? evidence.projectToken?.capturedAt ?? (/* @__PURE__ */ new Date()).toISOString();
  const resolvedProviderProfile = evidence.profile.profile_collection_state === "resolved" && evidence.profile.profile_provider === "twitterapi" && evidence.profile.display_name.trim();
  const officialProfileSource = resolvedProviderProfile ? profileSource(evidence, capturedAt) : null;
  if (officialProfileSource && evidence.roles.includes("PROJECT" /* PROJECT */)) {
    projected.push(makeFact(
      evidence,
      "official_identity",
      evidence.profile.display_name.trim(),
      [officialProfileSource],
      evidence.profile.handle
    ));
  }
  if (officialProfileSource && evidence.roles.includes("FOUNDER" /* FOUNDER */) && evidence.profile.identity_confidence !== "SuspectedImpersonation") {
    const existingVerifiedSources = (evidence.basicFacts ?? []).filter((fact) => fact.artifact_verified === true && (fact.status === "verified" || fact.status === "corroborated")).flatMap((fact) => fact.sources).filter((candidate) => candidate.relation === "supports" && candidate.provider !== "twitterapi" && candidate.url !== officialProfileSource.url);
    const aliases = [...new Set([
      evidence.profile.display_name.trim(),
      evidence.profile.resolved_name?.trim() ?? ""
    ].filter(Boolean))];
    const namedFrozenSource = existingVerifiedSources.find((candidate) => sourceMentionsSubject(candidate, aliases));
    const githubSource = githubIdentitySource(evidence, capturedAt);
    const identityAnchor = namedFrozenSource ?? githubSource;
    if (identityAnchor) {
      projected.push(makeFact(
        evidence,
        "official_identity",
        evidence.profile.resolved_name?.trim() || evidence.profile.display_name.trim(),
        [officialProfileSource, identityAnchor],
        evidence.profile.handle
      ));
    }
    const personVentures = evidence.ventures.filter((venture) => venture.artifact_verified === true && venture.evidence_origin !== "model_lead" && venture.project_name.trim() && venture.role.trim());
    for (const venture of personVentures) {
      const founderSources = existingVerifiedSources.filter((candidate) => sourceSupportsRelationship(candidate, venture, aliases, "founder"));
      if (FOUNDER_ROLE.test(venture.role) && founderSources.length) {
        const sources = [...founderSources];
        if (officialProfileSource && profileSupportsVenture(evidence, venture, "founder")) sources.push(officialProfileSource);
        projected.push(makeFact(
          evidence,
          "founder",
          venture.project_name.trim(),
          [...new Map(sources.map((candidate) => [candidate.url, candidate])).values()]
        ));
      }
      const currentSources = existingVerifiedSources.filter((candidate) => sourceSupportsRelationship(candidate, venture, aliases, "current_role"));
      if (CURRENT_AUTHORITY_ROLE.test(venture.role) && currentSources.length && currentRoleIsFullySupported(currentSources, venture, aliases)) {
        const sources = [...currentSources];
        if (officialProfileSource && profileSupportsVenture(evidence, venture, "current_role")) sources.push(officialProfileSource);
        projected.push(makeFact(
          evidence,
          "current_role",
          `${venture.role.trim()} at ${venture.project_name.trim()}`,
          [...new Map(sources.map((candidate) => [candidate.url, candidate])).values()]
        ));
      }
    }
  }
  const teamKeys = /* @__PURE__ */ new Set();
  for (const member of evidence.roles.includes("PROJECT" /* PROJECT */) ? evidence.webTeam ?? [] : []) {
    if (member.artifact_verified !== true || member.evidence_origin !== "deterministic" || member.provider !== "team-page" && member.provider !== "twitterapi" || !member.sourceUrl || !member.name.trim()) continue;
    const predicate = /\b(?:co[- ]?founder|founder|creator)\b/i.test(member.role) ? "founder" : /\b(?:ceo|cto|coo|cfo|chief|president|director|head|lead)\b/i.test(member.role) ? "executive" : null;
    if (!predicate) continue;
    const identityKey = member.handle?.replace(/^@/, "").toLowerCase() || normalizeValue(member.name);
    if (teamKeys.has(identityKey)) continue;
    teamKeys.add(identityKey);
    const excerpt = member.evidence?.trim() || `${member.name} is listed as ${member.role} by the project's fetched ${member.source}.`;
    projected.push(makeFact(evidence, predicate, member.name.trim(), [source({
      url: member.sourceUrl,
      title: member.source || "Project team source",
      excerpt,
      capturedAt,
      provider: member.provider,
      sourceClass: member.provider === "twitterapi" || isOfficialUrl(member.sourceUrl, officialHost(evidence)) ? "official_subject" : "other_public"
    })], member.role));
  }
  const token = evidence.roles.includes("PROJECT" /* PROJECT */) ? evidence.projectToken : void 0;
  if (token?.verified) {
    const tokenExcerpt = `${token.name} (${token.symbol}) is the canonical project token on ${token.chain}; its identity matched the project's ${token.verification === "official_x" ? "official X account" : "official domain"}.`;
    const tokenSource = source({
      url: token.sourceUrl,
      title: "CoinGecko token record",
      excerpt: tokenExcerpt,
      capturedAt: token.capturedAt,
      provider: (token.providers ?? ["coingecko"]).join(" + "),
      sourceClass: "regulatory_or_onchain"
    });
    projected.push(makeFact(evidence, "official_token", `$${token.symbol.toUpperCase()}`, [tokenSource], token.name));
    const chainFootprint = token.deployedChains?.length ? `${token.deployedChains.length} chains incl. ${token.deployedChains.slice(0, 4).join(", ")}` : token.chain;
    projected.push(makeFact(
      evidence,
      "network",
      chainFootprint,
      [tokenSource],
      token.deployedChains?.length ? "protocol footprint per DeFiLlama TVL" : void 0
    ));
    if (typeof token.volume24hUsd === "number" && token.volume24hUsd > 0) {
      projected.push(makeFact(
        evidence,
        "traction",
        `${formatUsd(token.volume24hUsd)} 24h trading volume`,
        [tokenSource],
        `captured ${token.capturedAt.slice(0, 10)}`
      ));
    }
    if (typeof token.circulatingSupply === "number" && token.circulatingSupply > 0 && (typeof token.maxSupply === "number" && token.maxSupply > 0 || typeof token.totalSupply === "number" && token.totalSupply > 0)) {
      const denominator = typeof token.maxSupply === "number" && token.maxSupply > 0 ? token.maxSupply : token.totalSupply;
      const pct = Math.min(100, Math.round(token.circulatingSupply / denominator * 100));
      const compact3 = (value) => value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : Math.round(value).toLocaleString();
      projected.push(makeFact(
        evidence,
        "tokenomics",
        `${compact3(token.circulatingSupply)} of ${compact3(denominator)} supply circulating (${pct}%)`,
        [tokenSource],
        `captured ${token.capturedAt.slice(0, 10)}`
      ));
    }
  }
  const github = evidence.roles.includes("PROJECT" /* PROJECT */) ? evidence.profile.identity_note.match(/GitHub\s+github\.com\/([A-Za-z0-9_.-]+)/i)?.[1] : void 0;
  if (github) {
    const url = `https://github.com/${github}`;
    projected.push(makeFact(evidence, "repository", `github.com/${github}`, [source({
      url,
      title: "Verified GitHub account",
      excerpt: evidence.profile.identity_note,
      capturedAt,
      provider: "github",
      sourceClass: isOfficialUrl(url, officialHost(evidence)) ? "official_subject" : "other_public"
    })]));
  }
  const isProject = evidence.roles.includes("PROJECT" /* PROJECT */);
  const isFounderSubject = evidence.roles.includes("FOUNDER" /* FOUNDER */);
  const enrichmentRecord = evidence.companyEnrichment?.funding && evidence.companyEnrichment.funding.rounds.length ? evidence.companyEnrichment : void 0;
  const fundingFact = isProject && evidence.protocolFunding && evidence.protocolFunding.rounds.length ? {
    rounds: evidence.protocolFunding.rounds.length,
    totalRaisedUsd: evidence.protocolFunding.totalRaisedUsd,
    leadInvestors: evidence.protocolFunding.leadInvestors,
    sourceUrl: evidence.protocolFunding.sourceUrl,
    capturedAt: evidence.protocolFunding.capturedAt,
    provider: "defillama",
    title: "DeFiLlama funding record",
    ventureName: "",
    subjectLabel: evidence.profile.display_name || "The project"
  } : (isProject || isFounderSubject) && enrichmentRecord && enrichmentRecord.funding ? {
    rounds: enrichmentRecord.funding.rounds.length,
    totalRaisedUsd: enrichmentRecord.funding.totalRaisedUsd ?? 0,
    leadInvestors: enrichmentRecord.funding.leadInvestors,
    sourceUrl: enrichmentRecord.sourceUrl,
    capturedAt: enrichmentRecord.capturedAt,
    provider: "monid",
    title: "Monid/Akta funding record",
    ventureName: isProject ? "" : enrichmentRecord.name,
    subjectLabel: isProject ? evidence.profile.display_name || "The project" : enrichmentRecord.name
  } : null;
  if (fundingFact) {
    const leads = fundingFact.leadInvestors.slice(0, 4).join(", ");
    const total = fundingFact.totalRaisedUsd > 0 ? ` \xB7 ${formatUsd(fundingFact.totalRaisedUsd)} raised` : "";
    const prefix = fundingFact.ventureName ? `${fundingFact.ventureName}: ` : "";
    projected.push(makeFact(
      evidence,
      "funding",
      `${prefix}${fundingFact.rounds} public funding round${fundingFact.rounds === 1 ? "" : "s"}${total}${leads ? ` \xB7 led by ${leads}` : ""}`,
      [source({
        url: fundingFact.sourceUrl,
        title: fundingFact.title,
        excerpt: `${fundingFact.subjectLabel} raised ${formatUsd(fundingFact.totalRaisedUsd)} across ${fundingFact.rounds} public funding round(s)${leads ? `, with lead investors including ${leads}` : ""}.`,
        capturedAt: fundingFact.capturedAt,
        provider: fundingFact.provider,
        sourceClass: "other_public"
      })],
      fundingFact.ventureName ? "venture financing" : void 0
    ));
  }
  const tvlSnapshot = isProject ? evidence.protocolTvl : void 0;
  if (tvlSnapshot && tvlSnapshot.tvlUsd > 0) {
    const chainList = tvlSnapshot.chains.slice(0, 3).join(", ");
    const historySince = tvlSnapshot.firstRecordedAt ? ` TVL history since ${tvlSnapshot.firstRecordedAt.slice(0, 4)}.` : "";
    const hackNote = tvlSnapshot.hacks?.length ? ` DeFiLlama also records ${tvlSnapshot.hacks.length} security incident${tvlSnapshot.hacks.length === 1 ? "" : "s"}${tvlSnapshot.hacks[0].amountUsd ? `, including ${formatUsd(tvlSnapshot.hacks[0].amountUsd)}${tvlSnapshot.hacks[0].date ? ` in ${tvlSnapshot.hacks[0].date.slice(0, 4)}` : ""}${tvlSnapshot.hacks[0].returnedFunds ? " (funds returned)" : ""}` : ""}.` : "";
    projected.push(makeFact(
      evidence,
      "traction",
      `${formatUsd(tvlSnapshot.tvlUsd)} total value locked${chainList ? ` (${chainList})` : ""}`,
      [source({
        url: tvlSnapshot.sourceUrl,
        title: "DeFiLlama TVL record",
        excerpt: `${tvlSnapshot.name} holds ${formatUsd(tvlSnapshot.tvlUsd)} in total value locked${chainList ? ` across ${chainList}` : ""} (DeFiLlama on-chain snapshot).${historySince}${hackNote}`,
        capturedAt: tvlSnapshot.capturedAt,
        provider: "defillama",
        sourceClass: "regulatory_or_onchain"
      })],
      `captured ${tvlSnapshot.capturedAt.slice(0, 10)}`
    ));
    if (tvlSnapshot.governanceIds?.length) {
      const snapshotSpace = tvlSnapshot.governanceIds.find((id) => id.startsWith("snapshot:"))?.slice("snapshot:".length);
      const onchainGovernor = tvlSnapshot.governanceIds.find((id) => id.startsWith("eip155:"));
      const parts = [
        ...snapshotSpace ? [`Snapshot space ${snapshotSpace} (off-chain voting)`] : [],
        ...onchainGovernor ? [`on-chain governor ${onchainGovernor.split(":").pop()?.slice(0, 10)}\u2026`] : []
      ];
      if (parts.length) {
        projected.push(makeFact(
          evidence,
          "governance",
          parts.join("; "),
          [source({
            url: tvlSnapshot.sourceUrl,
            title: "DeFiLlama governance listing",
            excerpt: `DeFiLlama lists governance identifiers for ${tvlSnapshot.name}: ${tvlSnapshot.governanceIds.join(", ")}.`,
            capturedAt: tvlSnapshot.capturedAt,
            provider: "defillama",
            sourceClass: "other_public"
          })]
        ));
      }
    }
  }
  const feesSnapshot = isProject ? evidence.protocolFees : void 0;
  if (feesSnapshot && typeof feesSnapshot.total30dUsd === "number" && feesSnapshot.total30dUsd > 0) {
    projected.push(makeFact(
      evidence,
      "traction",
      `${formatUsd(feesSnapshot.total30dUsd)} protocol fees in 30 days`,
      [source({
        url: feesSnapshot.sourceUrl,
        title: "DeFiLlama protocol fees record",
        excerpt: `Users paid ${formatUsd(feesSnapshot.total30dUsd)} in protocol fees over the trailing 30 days${typeof feesSnapshot.total24hUsd === "number" ? ` (${formatUsd(feesSnapshot.total24hUsd)} in the last 24 hours)` : ""}.`,
        capturedAt: feesSnapshot.capturedAt,
        provider: "defillama",
        sourceClass: "regulatory_or_onchain"
      })],
      `captured ${feesSnapshot.capturedAt.slice(0, 10)}`
    ));
  }
  const ventureToken = isFounderSubject && !isProject ? evidence.ventureToken : void 0;
  if (ventureToken?.verified) {
    projected.push(makeFact(
      evidence,
      "official_token",
      `$${ventureToken.symbol.toUpperCase()}`,
      [source({
        url: ventureToken.sourceUrl,
        title: "CoinGecko token record",
        excerpt: `${ventureToken.name} (${ventureToken.symbol}) is the canonical token of ${ventureToken.ventureName}, the subject's verified venture; its identity matched the venture's ${ventureToken.verification === "official_x" ? "official X account" : "official domain"}.`,
        capturedAt: ventureToken.capturedAt,
        provider: (ventureToken.providers ?? ["coingecko"]).join(" + "),
        sourceClass: "regulatory_or_onchain"
      })],
      `canonical token of ${ventureToken.ventureName}`
    ));
  }
  const founderProfile = isProject ? evidence.companyEnrichment?.management?.find((person) => /founder/i.test(person.title) || /\bceo\b/i.test(person.title)) : void 0;
  if (founderProfile?.name.trim() && evidence.companyEnrichment) {
    const prior = founderProfile.priorCompanies.filter(Boolean).slice(0, 3).join(", ");
    projected.push(makeFact(
      evidence,
      "founder",
      founderProfile.name.trim(),
      [source({
        url: founderProfile.linkedin || evidence.companyEnrichment.sourceUrl,
        title: founderProfile.linkedin ? "LinkedIn (Monid/Akta management record)" : "Monid/Akta management record",
        excerpt: `${founderProfile.name} is ${founderProfile.title} of ${evidence.companyEnrichment.name}${prior ? `; previously at ${prior}` : ""}${founderProfile.startYear ? ` (since ${founderProfile.startYear})` : ""}.`,
        capturedAt: evidence.companyEnrichment.capturedAt,
        provider: "monid",
        sourceClass: "other_public"
      })],
      founderProfile.title
    ));
  }
  const materialized = projected.map((fact) => mergeProjectedFact(evidence, fact));
  reconcileQuestionLedger(evidence, materialized);
}

// server/adapters/defiLlama.ts
var API_BASE = "https://api.llama.fi";
function defiLlamaSlug(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}
async function fetchProtocol(slug, fetcher) {
  const url = `${API_BASE}/protocol/${encodeURIComponent(slug)}`;
  let response;
  try {
    response = await fetcher(url, { signal: AbortSignal.timeout(2e4) });
  } catch {
    return { ok: false, notFound: false, note: "DeFiLlama was unavailable." };
  }
  if (!response.ok) {
    const notFound = response.status === 400;
    return {
      ok: false,
      notFound,
      note: notFound ? `No DeFiLlama protocol matched "${slug}".` : "DeFiLlama request failed."
    };
  }
  try {
    const data = await response.json() ?? {};
    return { ok: true, data };
  } catch {
    return { ok: false, notFound: false, note: "DeFiLlama response was unreadable." };
  }
}
var strArray = (value) => Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim()) : [];
var NON_CHAIN_SEGMENT = /(?:^|[-])(?:borrowed|staking|pool2|vesting|treasury|offers|options)(?:$|[-])/i;
async function collectProtocolTvl(projectName2, options = {}) {
  const fetcher = options.fetcher ?? fetch;
  const slug = options.slug ?? defiLlamaSlug(projectName2);
  if (!slug) return { available: false, note: "No resolvable DeFiLlama protocol slug." };
  const result = await fetchProtocol(slug, fetcher);
  if (!result.ok) {
    recordCall("defillama", "tvl", 0, `${slug} \xB7 ${result.notFound ? "not_found" : "error"}`, result.notFound ? "succeeded" : "failed");
    return { available: false, note: result.note };
  }
  const data = result.data;
  const series = Array.isArray(data.tvl) ? data.tvl : [];
  const latest = series.length ? series[series.length - 1] : void 0;
  const tvlUsd = typeof latest?.totalLiquidityUSD === "number" ? latest.totalLiquidityUSD : null;
  if (tvlUsd === null || !(tvlUsd > 0)) {
    recordCall("defillama", "tvl", 0, `${slug} \xB7 no_tvl`, "partial");
    return { available: false, note: "DeFiLlama returned no positive TVL for this protocol." };
  }
  const rawChainTvls = data.currentChainTvls && typeof data.currentChainTvls === "object" ? data.currentChainTvls : {};
  const chainBreakdown = Object.entries(rawChainTvls).filter(([chain, value]) => typeof value === "number" && value > 0 && !NON_CHAIN_SEGMENT.test(chain)).map(([chain, value]) => ({ chain, tvlUsd: value })).sort((a, b) => b.tvlUsd - a.tvlUsd);
  const firstPoint = series.length ? series[0] : void 0;
  const firstRecordedAt = typeof firstPoint?.date === "number" ? new Date(firstPoint.date * 1e3).toISOString().slice(0, 10) : null;
  const hacks = (Array.isArray(data.hacks) ? data.hacks : []).filter((entry) => Boolean(entry) && typeof entry === "object").map((entry) => ({
    date: typeof entry.date === "number" ? new Date(entry.date * 1e3).toISOString().slice(0, 10) : null,
    amountUsd: typeof entry.amount === "number" && entry.amount > 0 ? Math.round(entry.amount) : null,
    returnedFunds: entry.returnedFunds === true,
    classification: typeof entry.classification === "string" ? entry.classification : null
  }));
  recordCall("defillama", "tvl", 0, `${slug} \xB7 tvl_${Math.round(tvlUsd)}`, "succeeded");
  return {
    available: true,
    value: {
      slug,
      name: typeof data.name === "string" ? data.name : projectName2,
      symbol: typeof data.symbol === "string" ? data.symbol : null,
      tvlUsd,
      chains: chainBreakdown.map((entry) => entry.chain),
      chainBreakdown,
      geckoId: typeof data.gecko_id === "string" ? data.gecko_id : null,
      firstRecordedAt,
      governanceIds: strArray(data.governanceID),
      hacks,
      sourceUrl: `https://defillama.com/protocol/${slug}`
    }
  };
}
async function collectProtocolFees(projectName2, options = {}) {
  const fetcher = options.fetcher ?? fetch;
  const slug = options.slug ?? defiLlamaSlug(projectName2);
  if (!slug) return { available: false, note: "No resolvable DeFiLlama protocol slug." };
  const url = `${API_BASE}/summary/fees/${encodeURIComponent(slug)}`;
  let response;
  try {
    response = await fetcher(url, { signal: AbortSignal.timeout(2e4) });
  } catch {
    recordCall("defillama", "fees", 0, `${slug} \xB7 error`, "failed");
    return { available: false, note: "DeFiLlama fees endpoint was unavailable." };
  }
  if (!response.ok) {
    recordCall("defillama", "fees", 0, `${slug} \xB7 http_${response.status}`, response.status === 400 ? "succeeded" : "failed");
    return { available: false, note: `No DeFiLlama fee record for "${slug}".` };
  }
  let payload;
  try {
    payload = await response.json() ?? {};
  } catch {
    return { available: false, note: "DeFiLlama fees response was unreadable." };
  }
  const total24hUsd = typeof payload.total24h === "number" && payload.total24h >= 0 ? Math.round(payload.total24h) : null;
  const total30dUsd = typeof payload.total30d === "number" && payload.total30d >= 0 ? Math.round(payload.total30d) : null;
  if (total24hUsd === null && total30dUsd === null) {
    recordCall("defillama", "fees", 0, `${slug} \xB7 no_totals`, "succeeded");
    return { available: false, note: "DeFiLlama reported no fee totals for this protocol." };
  }
  recordCall("defillama", "fees", 0, `${slug} \xB7 fees30d_${total30dUsd ?? 0}`, "succeeded");
  return {
    available: true,
    value: {
      slug,
      total24hUsd,
      total30dUsd,
      sourceUrl: `https://defillama.com/protocol/${slug}`
    }
  };
}
var millionsToUsd = (value) => typeof value === "number" && value > 0 ? Math.round(value * 1e6) : null;
async function collectProtocolFunding(projectName2, options = {}) {
  const fetcher = options.fetcher ?? fetch;
  const slug = options.slug ?? defiLlamaSlug(projectName2);
  if (!slug) return { available: false, reason: "no_data", note: "No resolvable DeFiLlama protocol slug." };
  const result = await fetchProtocol(slug, fetcher);
  if (!result.ok) {
    recordCall("defillama", "funding", 0, `${slug} \xB7 ${result.notFound ? "not_found" : "error"}`, result.notFound ? "succeeded" : "failed");
    return {
      available: false,
      reason: result.notFound ? "no_data" : "unavailable",
      note: result.note
    };
  }
  const raw = Array.isArray(result.data.raises) ? result.data.raises : [];
  const rounds = raw.map((entry) => {
    const dateSec = typeof entry.date === "number" ? entry.date : null;
    const round = typeof entry.round === "string" && entry.round.trim() ? entry.round.trim() : "Undisclosed round";
    return {
      date: dateSec ? new Date(dateSec * 1e3).toISOString().slice(0, 10) : null,
      round,
      amountUsd: millionsToUsd(entry.amount),
      leadInvestors: strArray(entry.leadInvestors),
      otherInvestors: strArray(entry.otherInvestors),
      valuationUsd: millionsToUsd(entry.valuation)
    };
  }).sort((a, b) => a.date && b.date ? a.date.localeCompare(b.date) : 0);
  if (!rounds.length) {
    recordCall("defillama", "funding", 0, `${slug} \xB7 no_raises`, "succeeded");
    return { available: false, reason: "no_data", note: `No public funding rounds recorded for "${slug}" on DeFiLlama.` };
  }
  const leadInvestors = [...new Set(rounds.flatMap((round) => round.leadInvestors))];
  const totalRaisedUsd = rounds.reduce((sum, round) => sum + (round.amountUsd ?? 0), 0);
  recordCall("defillama", "funding", 0, `${slug} \xB7 ${rounds.length}_rounds`, "succeeded");
  return {
    available: true,
    value: {
      slug,
      name: typeof result.data.name === "string" ? result.data.name : projectName2,
      rounds,
      totalRaisedUsd,
      leadInvestors,
      sourceUrl: `https://defillama.com/protocol/${slug}`
    }
  };
}

// server/adapters/monid.ts
var API_BASE2 = "https://api.monid.ai/v1";
var PROVIDER = "akta";
var PER_SECTION_USD = 0.125;
var POLL_INTERVAL_MS = 2e3;
var POLL_TIMEOUT_MS = 3e4;
var RUN_TIMEOUT_MS = 3e4;
var ALLOWED_SECTIONS = [
  "funding_detail",
  "mna_and_investment",
  "management_profile",
  "firmographic",
  "financial_estimate",
  "company_assessment"
];
var DEFAULT_SECTIONS = [
  "funding_detail",
  "management_profile",
  "firmographic"
];
var isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;
var numOrNull = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
function toStringList(value) {
  if (!Array.isArray(value)) return [];
  const out = value.map(
    (entry) => typeof entry === "string" ? entry : entry && typeof entry === "object" && isNonEmptyString(entry.name) ? entry.name : ""
  ).map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  return [...new Set(out)];
}
function hostOf(value) {
  if (!isNonEmptyString(value)) return null;
  const host = value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
  return host || null;
}
function websiteUrl(value) {
  const host = hostOf(value);
  return host ? `https://${host}` : null;
}
function normalizeSections(input) {
  if (!input || input.length === 0) return [...DEFAULT_SECTIONS];
  const filtered = input.filter(
    (section) => ALLOWED_SECTIONS.includes(section)
  );
  return filtered.length ? [...new Set(filtered)] : [...DEFAULT_SECTIONS];
}
var TERMINAL_OK = "COMPLETED";
var TERMINAL_FAIL = /* @__PURE__ */ new Set(["FAILED", "BLOCKED", "TIMED_OUT", "STOPPED"]);
var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function extractData(run) {
  const output = run?.output;
  if (output && typeof output === "object" && !Array.isArray(output) && "data" in output) {
    return output.data;
  }
  return output;
}
function runId(run) {
  if (isNonEmptyString(run?.runId)) return run.runId.trim();
  if (isNonEmptyString(run?.id)) return run.id.trim();
  return null;
}
async function startRun(key, endpoint, input, fetcher) {
  let res;
  try {
    res = await fetcher(`${API_BASE2}/run`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ provider: PROVIDER, endpoint, input }),
      signal: AbortSignal.timeout(RUN_TIMEOUT_MS)
    });
  } catch {
    return { ok: false, note: "Monid was unavailable." };
  }
  if (!res.ok) return { ok: false, note: `Monid request failed (http_${res.status}).` };
  let run;
  try {
    run = await res.json();
  } catch {
    return { ok: false, note: "Monid response was unreadable." };
  }
  return resolveRun(run, key, fetcher);
}
async function resolveRun(initial, key, fetcher) {
  let current = initial;
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (let guard = 0; guard < 32; guard += 1) {
    const status = isNonEmptyString(current?.status) ? current.status : "";
    if (status === TERMINAL_OK) {
      const data = extractData(current);
      if (data === void 0 || data === null) {
        return { ok: false, note: "Monid run completed without data." };
      }
      return { ok: true, data };
    }
    if (TERMINAL_FAIL.has(status)) {
      return { ok: false, note: `Monid run ${status.toLowerCase()}.` };
    }
    const id = runId(current);
    if (!id) return { ok: false, note: "Monid run had no id to poll." };
    if (Date.now() >= deadline) return { ok: false, note: "Monid run timed out." };
    await sleep(POLL_INTERVAL_MS);
    const polled = await pollRun(id, key, fetcher);
    if (!polled.ok) return { ok: false, note: polled.note };
    current = polled.run;
  }
  return { ok: false, note: "Monid run did not settle." };
}
async function pollRun(id, key, fetcher) {
  let res;
  try {
    res = await fetcher(`${API_BASE2}/runs/${encodeURIComponent(id)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(RUN_TIMEOUT_MS)
    });
  } catch {
    return { ok: false, note: "Monid was unavailable while polling." };
  }
  if (!res.ok) return { ok: false, note: `Monid poll failed (http_${res.status}).` };
  try {
    return { ok: true, run: await res.json() };
  } catch {
    return { ok: false, note: "Monid poll response was unreadable." };
  }
}
function companyList(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object" && Array.isArray(data.data)) {
    return data.data;
  }
  return [];
}
function sectionRoot(data) {
  if (!data || typeof data !== "object") return {};
  const obj = data;
  if (ALLOWED_SECTIONS.some((section) => section in obj)) return obj;
  const nested = obj.data;
  if (nested && typeof nested === "object" && ALLOWED_SECTIONS.some((section) => section in nested)) {
    return nested;
  }
  return obj;
}
function pickBestMatch(companies, query) {
  const valid = companies.filter((company) => isNonEmptyString(company?.uuid));
  if (!valid.length) return null;
  const queryHost = hostOf(query);
  const queryName = query.trim().toLowerCase();
  if (queryHost) {
    const byWebsite = valid.find((company) => hostOf(company?.website) === queryHost);
    if (byWebsite) return byWebsite;
  }
  const byName = valid.find(
    (company) => isNonEmptyString(company?.name) && company.name.trim().toLowerCase() === queryName
  );
  if (byName) return byName;
  return valid[0];
}
function formatAktaDate(value) {
  if (!value || typeof value !== "object") return null;
  const raw = value;
  const year = numOrNull(raw.year);
  if (year === null) return null;
  const month = numOrNull(raw.month);
  const day = numOrNull(raw.day);
  const pad = (n) => String(n).padStart(2, "0");
  if (month === null) return String(year);
  if (day === null) return `${year}-${pad(month)}`;
  return `${year}-${pad(month)}-${pad(day)}`;
}
function startYearFrom(value) {
  if (typeof value === "string") {
    const match = value.match(/\b(\d{4})\b/);
    return match ? match[1] : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  if (value && typeof value === "object") {
    const year = numOrNull(value.year);
    return year === null ? null : String(year);
  }
  return null;
}
function parseFunding(section) {
  if (!section || typeof section !== "object") return void 0;
  const raw = section;
  const overview = raw.funding_overview && typeof raw.funding_overview === "object" ? raw.funding_overview : {};
  const totalRaisedUsd = numOrNull(overview.total_funding_usd);
  const rawRounds = Array.isArray(raw.funding_rounds) ? raw.funding_rounds : [];
  const rounds = rawRounds.map((entry) => {
    const investors = Array.isArray(entry?.investors) ? entry.investors : [];
    const namesWhere = (predicate) => [
      ...new Set(
        investors.filter(predicate).map((investor) => isNonEmptyString(investor?.name) ? investor.name.trim() : "").filter((name) => name.length > 0)
      )
    ];
    return {
      date: formatAktaDate(entry?.date),
      round: isNonEmptyString(entry?.round?.label) ? entry.round.label.trim() : "Undisclosed round",
      amountUsd: numOrNull(entry?.amount_usd),
      // absolute USD — do NOT multiply
      leadInvestors: namesWhere((investor) => investor?.lead_investor === true),
      otherInvestors: namesWhere((investor) => investor?.lead_investor !== true)
    };
  });
  if (totalRaisedUsd === null && rounds.length === 0) return void 0;
  const leadInvestors = [...new Set(rounds.flatMap((round) => round.leadInvestors))];
  return { totalRaisedUsd, rounds, leadInvestors };
}
function parseManagement(section) {
  if (!section || typeof section !== "object") return void 0;
  const profiles = Array.isArray(section.profiles) ? section.profiles : [];
  const people = profiles.map((profile) => {
    const name = isNonEmptyString(profile?.name) ? profile.name.trim() : "";
    if (!name) return null;
    return {
      name,
      title: isNonEmptyString(profile?.designation) ? profile.designation.trim() : "",
      priorCompanies: toStringList(profile?.previous_companies),
      linkedin: isNonEmptyString(profile?.social?.linkedin) ? profile.social.linkedin.trim() : null,
      startYear: startYearFrom(profile?.start_date)
    };
  }).filter((person) => person !== null);
  return people.length ? people : void 0;
}
function parseFirmographic(section) {
  if (!section || typeof section !== "object") return void 0;
  const raw = section;
  const legalName = isNonEmptyString(raw.legal_name) ? raw.legal_name.trim() : null;
  const foundedYearNum = numOrNull(raw.founded_year);
  const foundedYear = foundedYearNum === null ? null : String(foundedYearNum);
  const headcountRange = isNonEmptyString(raw.headcount_range) ? raw.headcount_range.trim() : null;
  const ownership = isNonEmptyString(raw.ownership_category) ? raw.ownership_category.trim() : null;
  if (!legalName && !foundedYear && !headcountRange && !ownership) return void 0;
  return { legalName, foundedYear, headcountRange, ownership };
}
async function collectCompanyEnrichment(nameOrWebsite, options = {}) {
  const key = env("MONID_API_KEY");
  if (!key) {
    return { available: false, reason: "no_key", note: "MONID_API_KEY is not configured." };
  }
  const query = (nameOrWebsite ?? "").trim();
  if (!query) {
    return { available: false, reason: "no_match", note: "No company name or website supplied." };
  }
  const fetcher = options.fetcher ?? fetch;
  const sections = normalizeSections(options.sections);
  const search = await startRun(
    key,
    "/v1/company/search",
    { queryParams: { query } },
    fetcher
  );
  if (!search.ok) {
    recordCall("monid", "company/search", 0, `search \xB7 ${search.note}`, "failed");
    return { available: false, reason: "unavailable", note: search.note };
  }
  const companies = companyList(search.data);
  const chosen = pickBestMatch(companies, query);
  const uuid = isNonEmptyString(chosen?.uuid) ? chosen.uuid.trim() : "";
  if (!chosen || !uuid) {
    recordCall("monid", "company/search", 0, "search \xB7 no_match", "succeeded");
    return {
      available: false,
      reason: "no_match",
      note: `No Monid/Akta company matched "${query}".`
    };
  }
  recordCall("monid", "company/search", 0, `search \xB7 matched ${uuid}`, "succeeded");
  const enrichment = await startRun(
    key,
    "/v1/company/enrichment",
    { queryParams: { company: uuid, sections } },
    fetcher
  );
  const sectionMeta = `enrichment \xB7 ${sections.length} section(s) \xB7 ${uuid}`;
  if (!enrichment.ok) {
    recordCall("monid", "company/enrichment", 0, `${sectionMeta} \xB7 ${enrichment.note}`, "failed");
    return { available: false, reason: "unavailable", note: enrichment.note };
  }
  recordCall("monid", "company/enrichment", sections.length * PER_SECTION_USD, sectionMeta, "succeeded");
  const root = sectionRoot(enrichment.data);
  const funding = sections.includes("funding_detail") ? parseFunding(root.funding_detail) : void 0;
  const management = sections.includes("management_profile") ? parseManagement(root.management_profile) : void 0;
  const firmographic = sections.includes("firmographic") ? parseFirmographic(root.firmographic) : void 0;
  const name = isNonEmptyString(chosen.name) ? chosen.name.trim() : firmographic?.legalName ?? query;
  return {
    available: true,
    value: {
      name,
      uuid,
      ...funding ? { funding } : {},
      ...management ? { management } : {},
      ...firmographic ? { firmographic } : {},
      sourceUrl: websiteUrl(chosen.website) ?? "https://monid.ai"
    }
  };
}

// server/orchestrate.ts
var VENTURE_ROLE_TOKENS = /\b(?:co[- ]?founders?|founders?|creators?|ceo|cto|coo|cfo|chief\s+\w+(?:\s+officer)?|presidents?|chair(?:man|woman|person)?|executives?)\b/gi;
var BIO_FOUNDER_CLAIM = /\b(?:co[- ]?founder|founder|creator|ceo|chief executive)\b/i;
function cleanVentureName(value) {
  const afterAt = value.split(/\bat\b/i).pop() ?? value;
  return afterAt.replace(VENTURE_ROLE_TOKENS, " ").replace(/[&,@]/g, " ").replace(/\s+/g, " ").trim();
}
function deriveFounderVentureCandidate(evidence) {
  const row = evidence.ventures.find((venture) => venture.artifact_verified === true && venture.evidence_origin !== "model_lead" && venture.project_name.trim() && /\b(?:co[- ]?founder|founder|creator|ceo|chief executive)\b/i.test(venture.role));
  if (row) {
    return {
      project_name: row.project_name.trim(),
      ...row.x_handle ? { x_handle: row.x_handle } : {},
      ...row.domain ? { domain: row.domain } : {}
    };
  }
  const verifiedFacts = (evidence.basicFacts ?? []).filter((fact) => fact.artifact_verified === true && (fact.status === "verified" || fact.status === "corroborated"));
  const officialHostOf = (fact) => fact.sources.filter((candidate) => candidate.sourceClass === "official_subject" && candidate.relation === "supports").map((candidate) => {
    try {
      return new URL(candidate.url).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      return "";
    }
  }).find((host) => host && !/(^|\.)x\.com$|(^|\.)twitter\.com$/i.test(host));
  const bioHandle = BIO_FOUNDER_CLAIM.test(evidence.profile.bio) ? evidence.profile.bio.match(/@([A-Za-z0-9_]{2,15})/)?.[1] : void 0;
  const handleKey = bioHandle?.toLowerCase() ?? "";
  const roleFact = verifiedFacts.find((fact) => (fact.predicate === "founder" || fact.predicate === "current_role") && cleanVentureName(fact.value).length > 1);
  if (roleFact) {
    const ventureName = cleanVentureName(roleFact.value);
    const nameKey = ventureName.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const handleAgrees = Boolean(nameKey && handleKey && (nameKey.startsWith(handleKey) || handleKey.startsWith(nameKey)));
    const officialHost2 = officialHostOf(roleFact);
    const hostLabelKey = (officialHost2?.split(".")[0] ?? "").replace(/[^a-z0-9]+/g, "");
    const hostAgrees = Boolean(nameKey && hostLabelKey && (nameKey.startsWith(hostLabelKey) || hostLabelKey.startsWith(nameKey)));
    if (handleAgrees || hostAgrees) {
      return {
        project_name: ventureName,
        ...handleAgrees && bioHandle ? { x_handle: `@${bioHandle}` } : {},
        ...hostAgrees && officialHost2 ? { domain: officialHost2 } : {}
      };
    }
  }
  if (bioHandle && handleKey) {
    for (const fact of verifiedFacts) {
      if (fact.predicate !== "official_identity" && fact.predicate !== "founder" && fact.predicate !== "current_role") continue;
      const officialHost2 = officialHostOf(fact);
      if (!officialHost2) continue;
      const label = (officialHost2.split(".")[0] ?? "").replace(/[^a-z0-9]+/g, "");
      if (label && (label.startsWith(handleKey) || handleKey.startsWith(label))) {
        return { project_name: bioHandle, x_handle: `@${bioHandle}`, domain: officialHost2 };
      }
    }
  }
  return null;
}
var MONID_ENRICHMENT_BUDGET_MS = 25e3;
var withWallClockBox = (work, budgetMs) => Promise.race([
  work,
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), budgetMs);
    if (typeof timer === "object" && "unref" in timer) timer.unref();
  })
]);
var ADAPTERS = [
  xAdapter,
  githubAdapter,
  peopledatalabsAdapter,
  offchainAdapter,
  // crunchbaseAdapter retired: DeFiLlama + Monid/Akta cover funding/backing.
  dexscreenerAdapter,
  coingeckoAdapter,
  // redditAdapter retired: Reddit API access was not approved.
  onchainAdapter,
  basicFactsAdapter
];
var teamEvidenceRank = (member) => member.artifact_verified === true && member.evidence_origin !== "model_lead" ? 2 : member.evidence_origin !== "model_lead" ? 1 : 0;
function coalesceTeamMembersByHandle(members) {
  const output = [];
  const indexByHandle = /* @__PURE__ */ new Map();
  for (const member of members) {
    const handle = member.handle?.trim().replace(/^@/, "").toLowerCase() ?? "";
    const existingIndex = handle ? indexByHandle.get(handle) : void 0;
    if (existingIndex === void 0) {
      output.push({ ...member });
      if (handle) indexByHandle.set(handle, output.length - 1);
      continue;
    }
    const existing = output[existingIndex];
    const preferred = teamEvidenceRank(member) > teamEvidenceRank(existing) ? member : existing;
    const secondary = preferred === existing ? member : existing;
    const merged = { ...preferred };
    if (!merged.handle && secondary.handle) merged.handle = secondary.handle;
    if (!merged.linkedin && secondary.linkedin) merged.linkedin = secondary.linkedin;
    if ((!merged.projects || !merged.projects.length) && secondary.projects?.length) {
      merged.projects = secondary.projects;
      merged.projects_evidence_origin = secondary.projects_evidence_origin;
    }
    if (secondary.identity_link_evidence_origin !== "model_lead" && preferred.identity_link_evidence_origin === "model_lead") {
      merged.identity_link_evidence_origin = secondary.identity_link_evidence_origin;
      if (secondary.handle) merged.handle = secondary.handle;
      if (secondary.linkedin) merged.linkedin = secondary.linkedin;
    }
    output[existingIndex] = merged;
  }
  return output;
}
var KEYED = /* @__PURE__ */ new Set(["x", "github", "peopledatalabs", "crunchbase", "reddit", "onchain", "basic-facts"]);
var attemptTotals = (providers, operations) => {
  const allow = providers ? new Set(providers) : null;
  const allowOperations = operations ? new Set(operations) : null;
  return getCost().calls.reduce((totals, line) => {
    if (allow && !allow.has(line.provider)) return totals;
    if (allowOperations && !allowOperations.has(line.op)) return totals;
    totals.total += line.calls;
    totals.succeeded += line.succeeded;
    totals.partial += line.partial;
    totals.failed += line.failed;
    totals.cached += line.cached;
    return totals;
  }, { total: 0, succeeded: 0, partial: 0, failed: 0, cached: 0 });
};
var ANALYST_ATTEMPT_PROVIDERS = ["claude", "grok"];
var analystAttemptTotals = (operations) => attemptTotals(ANALYST_ATTEMPT_PROVIDERS, operations);
var attemptDelta = (before, after) => ({
  total: Math.max(0, after.total - before.total),
  succeeded: Math.max(0, after.succeeded - before.succeeded),
  partial: Math.max(0, after.partial - before.partial),
  failed: Math.max(0, after.failed - before.failed),
  cached: Math.max(0, after.cached - before.cached)
});
var observedRunState = (attempts) => {
  if (attempts.total === 0) return "skipped";
  if (attempts.failed === attempts.total) return "failed";
  if (attempts.failed > 0 || attempts.partial > 0) return "partial";
  return "executed";
};
var adapterRunState = (result, attempts) => {
  if (result?.state === "failed" || result?.state === "partial") return result.state;
  if (attempts.total === 0) return "skipped";
  return observedRunState(attempts);
};
var delay = (ms) => new Promise((r) => setTimeout(r, ms));
function parseOutcome(s) {
  if (!s) return "Unknown" /* UNKNOWN */;
  const match = Object.values(VentureOutcome).find((v) => v.toLowerCase() === s.toLowerCase());
  return match ?? "Unknown" /* UNKNOWN */;
}
function asRoles(roles) {
  const valid = new Set(Object.values(SubjectClass));
  let out = roles.filter((r) => valid.has(r)).map((r) => r);
  if (out.includes("INVESTOR" /* INVESTOR */) && out.includes("PROJECT" /* PROJECT */)) {
    out = out.filter((r) => r !== "PROJECT" /* PROJECT */);
  }
  return out;
}
async function resolveProfile(ctx) {
  const prof = await getProfile2(ctx.handle);
  if (prof) {
    ctx.evidence.profile.profile_collection_state = "resolved";
    ctx.evidence.profile.profile_provider = "twitterapi";
    ctx.evidence.profile.profile_captured_at = (/* @__PURE__ */ new Date()).toISOString();
    ctx.evidence.profile.display_name = prof.name ?? ctx.evidence.profile.display_name;
    if (prof.image) {
      ctx.evidence.profile.avatar_url = prof.image;
      ctx.evidence.profile.avatar_source_state = "resolved";
    } else {
      ctx.evidence.profile.avatar_source_state = "none";
    }
    ctx.evidence.profile.bio = prof.bio ?? "";
    const profileWebsite = canonicalPublicProfileWebsite(prof.website) ?? void 0;
    ctx.evidence.profile.website = profileWebsite;
    if (prof.followers != null) ctx.evidence.profile.followers = fmtFollowers(prof.followers);
    if (prof.createdAt) {
      const d = new Date(prof.createdAt);
      if (!isNaN(d.getTime())) ctx.evidence.profile.joined = d.toLocaleString("en-US", { month: "short", year: "numeric" });
    }
    ctx.emit({ phase: "P0 \xB7 Intake", label: "Resolve profile", detail: `${prof.name ?? ctx.handle} \xB7 ${ctx.evidence.profile.followers} followers \xB7 joined ${ctx.evidence.profile.joined}`, source: "twitterapi.io", tone: "neutral" });
  } else {
    ctx.evidence.profile.profile_collection_state = "unavailable";
    ctx.evidence.profile.profile_provider = "twitterapi";
    ctx.evidence.profile.profile_captured_at = void 0;
    ctx.emit({ phase: "P0 \xB7 Intake", label: "Profile unavailable", detail: "twitterapi.io has no record of this handle (not in their index). Continuing with web/X discovery.", source: "twitterapi.io", tone: "warn" });
  }
}
function applySiteSubstanceOutcome(ctx, domain, site) {
  ctx.evidence.profile.website = site.url;
  const isProject = ctx.evidence.roles.includes("PROJECT" /* PROJECT */);
  const verifiedProjectToken = ctx.evidence.projectToken?.verified === true ? ctx.evidence.projectToken : void 0;
  const verifiedNotLive = site.status === "coming_soon" && (site.reason === "coming_soon" || site.reason === "parked");
  if (!isProject) {
    ctx.emit({
      phase: "P2 \xB7 Substance",
      label: verifiedNotLive ? "Profile website is not launched" : site.status === "coming_soon" ? "Profile website check unavailable" : "Profile website checked",
      detail: verifiedNotLive ? `${domain} serves a verified coming-soon or parked page. This personal-profile URL is not treated as project counter-evidence.` : site.status === "coming_soon" ? `${domain} returned an ungrounded coming-soon label. No profile or project-liveness conclusion was drawn.` : `${domain}: ${site.detail}. No project-liveness conclusion was drawn for this person profile.`,
      source: "site-fetch",
      tone: "neutral"
    });
    return;
  }
  if (verifiedNotLive) {
    ctx.recordCheck?.({
      id: "project-product-substance",
      status: "finding",
      note: `${domain}: ${site.detail}`,
      provider: "site-fetch",
      sourceCount: 1
    });
    const tokenContext = verifiedProjectToken ? ` No live product surface despite the account promoting the verified $${verifiedProjectToken.symbol} project token.` : " No live product surface was verified.";
    ctx.evidence.findings.push({
      finding_type: "SiteNotLive",
      claim: `The project's own website (${domain}) is not live yet: ${site.detail}.${tokenContext}`,
      source_url: site.url,
      source_date: "",
      source_author: "site-fetch",
      verification_status: "Verified",
      independent_source_count: 1,
      polarity: -1,
      evidence_origin: "deterministic",
      artifact_verified: true
    });
    ctx.emit({
      phase: "P2 \xB7 Substance",
      label: "Website not live",
      detail: verifiedProjectToken ? `${domain} is a verified coming-soon or parked page: ${site.detail}. The account promotes the verified $${verifiedProjectToken.symbol} project token, so this is product-substance counter-evidence.` : `${domain} is a verified coming-soon or parked page: ${site.detail}. This is product-substance counter-evidence, but no token-promotion claim was inferred.`,
      source: "site-fetch",
      tone: "bad"
    });
    return;
  }
  if (site.status === "coming_soon") {
    ctx.recordCheck?.({
      id: "project-product-substance",
      status: "unavailable",
      note: `${domain}: coming-soon classification lacked a verified served-page marker`,
      provider: "site-fetch"
    });
    ctx.emit({
      phase: "P2 \xB7 Substance",
      label: "Website check unavailable",
      detail: `${domain}: a coming-soon label was returned without direct served-page evidence. No liveness conclusion was drawn.`,
      source: "site-fetch",
      tone: "neutral"
    });
    return;
  }
  if (site.status === "access_blocked" || site.status === "unavailable" || site.status === "unreachable") {
    ctx.recordCheck?.({
      id: "project-product-substance",
      status: "unavailable",
      note: `${domain}: ${site.detail}; no adverse site-liveness conclusion was drawn`,
      provider: "site-fetch"
    });
    ctx.emit({
      phase: "P2 \xB7 Substance",
      label: "Website check unavailable",
      detail: `${domain}: ${site.detail}. This is a neutral provider gap, not evidence that the website or product is offline.`,
      source: "site-fetch",
      tone: "neutral"
    });
    return;
  }
  ctx.recordCheck?.({
    id: "project-product-substance",
    status: "confirmed",
    note: `${domain}: ${site.detail}`,
    provider: "site-fetch",
    sourceCount: 1
  });
  if (site.status === "client_rendered") {
    ctx.emit({ phase: "P2 \xB7 Substance", label: "Website live (app)", detail: `${domain} serves a client-rendered app; ${site.detail}.`, source: "site-fetch", tone: "neutral" });
  } else {
    ctx.emit({ phase: "P2 \xB7 Substance", label: "Website live", detail: `${domain} is a live site: ${site.detail}.`, source: "site-fetch", tone: "good" });
  }
}
async function collectProjectSiteSubstance(ctx, domain) {
  if (!domain) return;
  const site = await checkSiteSubstance(domain).catch(() => null);
  if (!site) return;
  applySiteSubstanceOutcome(ctx, domain, site);
}
async function coldIntake(ctx, profileAlreadyResolved = false) {
  if (!profileAlreadyResolved) await resolveProfile(ctx);
  const siteUrl = canonicalPublicProfileWebsite(ctx.evidence.profile.website) ?? void 0;
  const hist = await handleHistory(ctx.handle);
  if (hist && hist.priorHandles.length) {
    ctx.evidence.profile.prior_handles = hist.priorHandles;
    ctx.recordCheck?.({
      id: "identity-continuity",
      status: "finding",
      note: `prior handles found: ${hist.priorHandles.map((handle) => `@${handle}`).join(", ")}`,
      provider: "memory.lol",
      sourceCount: hist.priorHandles.length
    });
    ctx.emit({ phase: "P0 \xB7 Intake", label: "Handle history", detail: `This account previously went by ${hist.priorHandles.map((p) => "@" + p).join(", ")}, indicating a rebrand. Old posts and mentions are searched too.`, source: "memory.lol", tone: "warn" });
  } else if (hist) {
    ctx.recordCheck?.({
      id: "identity-continuity",
      status: "checked-empty",
      note: "handle-history provider returned no prior handle (provider coverage is partial)",
      provider: "memory.lol"
    });
    ctx.emit({ phase: "P0 \xB7 Intake", label: "Handle history", detail: "No prior X handle on record for this account (no rebrand found; memory.lol coverage is partial).", source: "memory.lol", tone: "neutral" });
  }
  const corpus = await collectCorpus(ctx.handle);
  const posts = corpus.posts;
  if (posts.length) {
    ctx.evidence.recentActivity = corpus.newest.length ? corpus.newest : posts;
    ctx.emit({ phase: "P0 \xB7 Intake", label: "Recent activity", detail: `Assembled a ${posts.length}-post claim corpus (${corpus.count.originals} recent originals + ${corpus.count.searched} from keyword search over full history) to mine for self-claims.`, source: "twitterapi.io", tone: "neutral" });
  }
  const foundWallets = await resolveForHandle(ctx.handle, [ctx.evidence.profile.bio, ...posts].join(" \n "));
  if (foundWallets.length) {
    for (const w of foundWallets) {
      ctx.evidence.wallets.push({ address: w.address, chain: w.chain, link_tier: w.tier, notes: w.source });
    }
    ctx.emit({ phase: "P0 \xB7 Intake", label: "Wallet resolved", detail: `${foundWallets.length} wallet${foundWallets.length > 1 ? "s" : ""}: ${foundWallets.map((w) => `${w.address.slice(0, 8)}\u2026 (${w.chain}, ${w.source.includes("Farcaster") ? "Farcaster" : "self-disclosed"})`).join(", ")}. Running on-chain forensics.`, source: "find-wallet", tone: "good" });
  }
  const bioDomain = ctx.evidence.profile.bio.match(/\b([a-z0-9-]+\.(?:xyz|io|com|fi|net|finance|app|org|co|gg|network|dev|ai|so|money))\b/i)?.[1];
  const domain = (siteUrl ?? (bioDomain ? `https://${bioDomain}` : "")).replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  await collectProjectSiteSubstance(ctx, domain);
  const canExtractClaims = analystAvailable();
  if (canExtractClaims) {
    ctx.emit({ phase: "P0 \xB7 Intake", label: "Extract claims", detail: "Reading the subject's bio and posts for self-claims to verify\u2026", tone: "neutral" });
  }
  const teamDomain = domain || `${ctx.handle.replace(/^@/, "").toLowerCase()}.com`;
  const claimsPromise = canExtractClaims ? extractClaims(ctx.handle, ctx.evidence.profile.bio, posts) : Promise.resolve(null);
  const discoveryPromise = Promise.all([
    discoverAffiliations(ctx.handle, ctx.evidence.profile.display_name, ctx.evidence.profile.prior_handles ?? []),
    // Team announcements are usually old, high-signal posts. `posts` is the
    // claim-targeted full-history corpus; `recentActivity` intentionally keeps
    // only the newest originals for cadence and tone. Passing the latter here
    // silently discarded the historical founder/team posts we had already paid
    // twitterapi.io to retrieve.
    findTeam(ctx.handle, ctx.evidence.profile.display_name, posts),
    // Run the deeper web/LinkedIn/press team search whenever we have EITHER a
    // domain or a project name — a big public project's roster lives off-X, and
    // many project accounts put no plain domain in the bio.
    domain || ctx.evidence.profile.display_name ? findTeamOnSite(domain, ctx.evidence.profile.display_name) : Promise.resolve([]),
    // Read the project's own /team page directly (Grok's summary can miss it).
    fetchTeamPage(teamDomain, ctx.evidence.profile.display_name)
  ]);
  const claims = await claimsPromise;
  if (claims) {
    const candidateRoles = [...new Set(asRoles(claims.roles))];
    for (const role of candidateRoles) {
      ctx.evidence.findings.push({
        finding_type: "RoleCandidate",
        claim: `Model-extracted self-claim suggests ${role}; provider corroboration is required before routing.`,
        source_url: "",
        source_date: "",
        source_author: "ai-analyst-intake",
        verification_status: "Rumor",
        independent_source_count: 0,
        polarity: 0,
        evidence_origin: "model_lead",
        artifact_verified: false,
        finding_scope: {
          scope: "direct_subject",
          target_entity_key: ctx.evidence.profile.handle,
          target_entity_type: "person",
          relationship_to_subject: "self",
          relationship_label: "audited subject role claim"
        }
      });
    }
    ctx.evidence.ventures = claims.ventures.map((v) => ({
      project_name: v.project_name,
      role: v.role ?? "founder",
      period: v.period ?? "",
      outcome: parseOutcome(v.claimed_outcome),
      evidence_origin: "model_lead",
      artifact_verified: false
    }));
    ctx.evidence.testimonials = claims.testimonials.map((t) => ({
      claimed_endorser_handle: t.claimed_endorser_handle,
      claimed_relationship: t.claimed_relationship,
      appears_at: "subject surfaces",
      evidence_origin: "model_lead",
      artifact_verified: false
    }));
    ctx.evidence.advised = claims.advised.map((p) => ({
      project_name: p.project_name,
      project_handle: p.project_handle,
      claimed_role: p.claimed_role ?? "advisor",
      appears_at: "subject surfaces",
      evidence_origin: "model_lead",
      artifact_verified: false
    }));
    ctx.evidence.promotions = claims.promotions.map((p) => ({
      ticker: p.ticker,
      contract_address: p.contract_address,
      chain: p.chain,
      evidence_origin: "model_lead",
      artifact_verified: false
    }));
    const n = claims.ventures.length + claims.testimonials.length + claims.advised.length + claims.promotions.length;
    ctx.emit({ phase: "P0 \xB7 Intake", label: "Claims extracted", detail: `${n} self-claims across ${candidateRoles.join(", ") || "no role candidates"}. Role candidates remain non-governing until independently verified.`, source: "AI analyst", tone: "neutral" });
  }
  ctx.emit({ phase: "P0 \xB7 Intake", label: "Discover affiliations", detail: "Three angles in parallel: what this account is tied to, who has named them, and the team named in their own X posts\u2026", source: "grok", tone: "neutral" });
  const [bySubject, people, siteTeam, pageTeam] = await discoveryPromise;
  const postRoleTeam = scanPostsForRoles(posts, ctx.evidence.profile.display_name);
  const webTeam = ctx.evidence.webTeam ?? (ctx.evidence.webTeam = []);
  const norm2 = (s) => (s ?? "").trim().toLowerCase().replace(/^@/, "");
  const byHandle = /* @__PURE__ */ new Map();
  const byName = /* @__PURE__ */ new Map();
  const teamCandidates = [
    ...pageTeam.map((member) => ({
      ...member,
      evidence_origin: domain ? "deterministic" : "model_lead",
      artifact_verified: !!domain,
      provider: domain ? "team-page" : "team-page-candidate",
      identity_link_evidence_origin: domain ? "deterministic" : "model_lead",
      projects_evidence_origin: domain ? "deterministic" : "model_lead"
    })),
    ...siteTeam.map((member) => ({
      ...member,
      evidence_origin: "model_lead",
      artifact_verified: false,
      provider: "grok",
      identity_link_evidence_origin: "model_lead",
      projects_evidence_origin: "model_lead"
    })),
    ...people.map((member) => ({
      ...member,
      evidence_origin: "model_lead",
      artifact_verified: false,
      provider: "grok",
      identity_link_evidence_origin: "model_lead",
      projects_evidence_origin: "model_lead"
    })),
    ...postRoleTeam.map((member) => ({
      ...member,
      evidence_origin: "deterministic",
      artifact_verified: true,
      provider: "twitterapi",
      identity_link_evidence_origin: "deterministic",
      projects_evidence_origin: "deterministic"
    }))
  ];
  for (const t of teamCandidates) {
    const h = t.handle ? norm2(t.handle) : "";
    const n = norm2(t.name);
    if (!h && !n) continue;
    const existing = h && byHandle.get(h) || n && byName.get(n) || null;
    if (existing) {
      if (!existing.handle && t.handle) {
        existing.handle = t.handle;
        existing.identity_link_evidence_origin = t.identity_link_evidence_origin;
        byHandle.set(norm2(t.handle), existing);
      }
      if (!existing.linkedin && t.linkedin) {
        existing.linkedin = t.linkedin;
        existing.identity_link_evidence_origin = t.identity_link_evidence_origin;
      }
      if ((!existing.projects || !existing.projects.length) && t.projects?.length) {
        existing.projects = t.projects;
        existing.projects_evidence_origin = t.projects_evidence_origin;
      }
      if (t.artifact_verified === true && existing.artifact_verified !== true) {
        existing.role = t.role;
        existing.evidence_origin = "deterministic";
        existing.artifact_verified = true;
        existing.provider = t.provider;
        existing.source = t.source ?? existing.source;
        existing.sourceUrl = t.sourceUrl ?? existing.sourceUrl;
        existing.evidence = t.evidence ?? existing.evidence;
      }
      continue;
    }
    const rec = {
      name: t.name,
      handle: t.handle,
      role: t.role,
      linkedin: t.linkedin,
      evidence: t.evidence,
      source: t.source ?? "X content",
      sourceUrl: t.sourceUrl,
      projects: t.projects,
      evidence_origin: t.evidence_origin,
      artifact_verified: t.artifact_verified,
      provider: t.provider,
      identity_link_evidence_origin: t.identity_link_evidence_origin,
      projects_evidence_origin: t.projects_evidence_origin
    };
    webTeam.push(rec);
    if (h) byHandle.set(h, rec);
    if (n) byName.set(n, rec);
  }
  const subj = norm2(ctx.handle);
  const accountVouchesTeam = !!domain || postRoleTeam.length > 0 || webTeam.some((t) => t.artifact_verified === true && norm2(t.handle) === subj);
  if (webTeam.length && !accountVouchesTeam) {
    ctx.emit({ phase: "P1 \xB7 Team", label: "Uncorroborated team lead", detail: `Found a possible team for the name "${ctx.evidence.profile.display_name || ctx.handle}", but nothing ties THIS account to it. Its handle isn't independently matched, it links no site, and its own posts name no team. Preserved for follow-up but excluded from scoring and the trust graph.`, source: "team-search", tone: "warn" });
    for (const member of webTeam) {
      member.evidence_origin = "model_lead";
      member.artifact_verified = false;
      member.identity_link_evidence_origin = "model_lead";
      member.projects_evidence_origin = "model_lead";
    }
  }
  const nameOnly = webTeam.filter((m) => !m.handle && !m.linkedin).slice(0, 15);
  if (nameOnly.length >= 1) {
    const found = await enrichTeamIdentities(ctx.evidence.profile.display_name || ctx.handle, nameOnly.map((m) => ({ name: m.name, role: m.role })));
    let linked = 0;
    for (const f of found) {
      const m = byName.get(norm2(f.name));
      if (!m) continue;
      if (!m.handle && f.handle) {
        m.handle = f.handle;
        m.identity_link_evidence_origin = "model_lead";
        byHandle.set(norm2(f.handle), m);
        linked++;
      }
      if (!m.linkedin && f.linkedin) {
        m.linkedin = f.linkedin;
        m.identity_link_evidence_origin = "model_lead";
        if (!f.handle) linked++;
      }
    }
    if (linked) ctx.emit({ phase: "P1 \xB7 Team", label: "Identities linked", detail: `Resolved X/LinkedIn for ${linked} of ${nameOnly.length} name-only team members.`, source: "grok", tone: "good" });
  }
  const coalescedTeam = coalesceTeamMembersByHandle(webTeam);
  if (coalescedTeam.length !== webTeam.length) {
    webTeam.splice(0, webTeam.length, ...coalescedTeam);
  }
  if (webTeam.length) {
    ctx.emit({ phase: "P1 \xB7 Team", label: "Team assembled", detail: `${webTeam.length} people behind the project: ${webTeam.slice(0, 6).map((t) => t.name + (t.handle ? ` ${t.handle}` : "")).join(", ")}${domain ? ` (site + posts)` : " (posts)"}.`, source: "team-search", tone: "good" });
    const isLeader = (r) => /founder|cofounder|co-founder|ceo|cto|coo|president|chief/i.test(r ?? "");
    const backedTeam = [...domain ? pageTeam : [], ...postRoleTeam].filter(
      (candidate) => webTeam.some(
        (member) => !!candidate.handle && norm2(candidate.handle) === norm2(member.handle) || !!candidate.name && norm2(candidate.name) === norm2(member.name)
      )
    );
    const leaders = backedTeam.filter((t) => isLeader(t.role));
    const leaderWithLinkedin = pageTeam.some((t) => isLeader(t.role) && !!t.linkedin);
    const rank = { Unverified: 0, Probable: 1, Confirmed: 2 };
    const cur = ctx.evidence.profile.identity_confidence;
    if (backedTeam.length) {
      ctx.recordCheck?.({
        id: "affiliations-associates",
        status: "confirmed",
        note: `${backedTeam.length} team identit${backedTeam.length === 1 ? "y" : "ies"} backed by a first-party team page or deterministic post scan`,
        provider: "team-page/post-scan",
        sourceCount: backedTeam.length
      });
      ctx.recordCheck?.({
        id: "project-team-identity",
        status: "confirmed",
        note: `${backedTeam.length} project team identit${backedTeam.length === 1 ? "y" : "ies"} backed by first-party team or account evidence`,
        provider: "team-page/post-scan",
        sourceCount: backedTeam.length
      });
    }
    if (cur !== "SuspectedImpersonation") {
      const target = leaderWithLinkedin ? "Confirmed" : leaders.length || backedTeam.length >= 2 ? "Probable" : null;
      if (target) {
        ctx.recordCheck?.({
          id: "identity-resolution",
          status: "confirmed",
          note: `project identity resolved through ${backedTeam.length} independently collected team record${backedTeam.length === 1 ? "" : "s"}`,
          provider: "team-page/post-scan",
          sourceCount: backedTeam.length
        });
      }
      if (target && (rank[target] ?? 0) > (rank[cur ?? "Unverified"] ?? 0)) {
        ctx.evidence.profile.identity_confidence = target;
        ctx.emit({ phase: "P1 \xB7 Team", label: `Identity ${target.toLowerCase()}`, detail: `Project identity resolved through independently fetched team evidence${leaderWithLinkedin ? " (a first-party team page links its leadership)" : ""}; a brand handle over a public team is not an anonymity flag.`, source: "team-page / post scan", tone: "good" });
      }
    }
  } else if (domain) {
    ctx.recordCheck?.({
      id: "project-team-identity",
      status: "checked-empty",
      note: "the official site and project account were checked, but no named team member was attributable",
      provider: "team-page/post-scan"
    });
    ctx.emit({ phase: "P1 \xB7 Team", label: "No named team", detail: `Dug ${domain} and the account's posts; no individual team members could be attributed. For a project raising money, an unnamed team is itself a flag.`, source: "team-search", tone: "warn" });
  }
  if (people.length) {
    const teamList = people.filter((p) => p.kind === "team");
    const advisorList = people.filter((p) => p.kind === "advisor");
    const haveAssoc = new Set(ctx.evidence.associates.map((a) => a.associate_handle.replace(/^@/, "").toLowerCase()));
    const haveTest = new Set(ctx.evidence.testimonials.map((t) => (t.claimed_endorser_handle ?? "").replace(/^@/, "").toLowerCase()));
    const addedTeam = [];
    for (const t of teamList) {
      if (!t.handle) continue;
      const key = t.handle.replace(/^@/, "").toLowerCase();
      if (haveAssoc.has(key)) continue;
      haveAssoc.add(key);
      ctx.evidence.associates.push({
        associate_handle: t.handle,
        relation: `team: ${t.role}`,
        notes: t.evidence,
        provider: "grok",
        evidence_origin: "model_lead",
        artifact_verified: false
      });
      addedTeam.push(`${t.name} (${t.handle})`);
    }
    const addedAdv = [];
    for (const a of advisorList) {
      if (!a.handle) continue;
      const key = a.handle.replace(/^@/, "").toLowerCase();
      if (haveTest.has(key)) continue;
      haveTest.add(key);
      ctx.evidence.testimonials.push({
        claimed_endorser_handle: a.handle,
        claimed_relationship: "advisor",
        appears_at: "model search of project X content",
        evidence_origin: "model_lead",
        artifact_verified: false
      });
      addedAdv.push(`${a.name} (${a.handle})`);
    }
    const namedOnly = people.filter((p) => !p.handle).map((p) => `${p.name} (${p.kind === "advisor" ? "advisor" : p.role})`);
    if (addedTeam.length) ctx.emit({ phase: "P0 \xB7 Intake", label: "Team surfaced", detail: `${addedTeam.length} team member${addedTeam.length === 1 ? "" : "s"} named in this account's X content: ${addedTeam.slice(0, 6).join(", ")}.`, source: "grok", tone: "good" });
    if (addedAdv.length) ctx.emit({ phase: "P0 \xB7 Intake", label: "Advisors surfaced", detail: `${addedAdv.length} advisor${addedAdv.length === 1 ? "" : "s"}/backer${addedAdv.length === 1 ? "" : "s"} claimed in X content (corroborating each): ${addedAdv.slice(0, 6).join(", ")}.`, source: "grok", tone: "neutral" });
    if (namedOnly.length) ctx.emit({ phase: "P0 \xB7 Intake", label: "Named only", detail: `Also named without a handle (not auditable): ${namedOnly.slice(0, 5).join(", ")}.`, source: "grok", tone: "neutral" });
  }
  const mergedMap = /* @__PURE__ */ new Map();
  for (const v of bySubject) {
    const k = v.name.toLowerCase();
    const ex = mergedMap.get(k);
    if (!ex) mergedMap.set(k, v);
    else mergedMap.set(k, { ...ex, x_handle: ex.x_handle ?? v.x_handle, domain: ex.domain ?? v.domain, evidence: ex.evidence ?? v.evidence, role: ex.role || v.role });
  }
  const discovered = [...mergedMap.values()];
  if (discovered.length) {
    const have = new Set(ctx.evidence.ventures.map((v) => v.project_name.toLowerCase()));
    const pending = discovered.filter((v) => {
      const k = v.name.toLowerCase();
      if (have.has(k)) return false;
      have.add(k);
      return true;
    }).map((v) => {
      const rec = {
        project_name: v.name,
        // Canonical bridge keys — the venture's own X account / domain. Without
        // these the graph keys the project on its fuzzy name and never connects
        // it to the same project seen in another audit.
        x_handle: v.x_handle,
        domain: v.domain,
        role: v.role,
        period: v.year ?? "",
        outcome: "Active" /* ACTIVE */,
        evidence_url: null,
        notes: [v.evidence, "single-source lead, unverified"].filter(Boolean).join(" \xB7 "),
        evidence_origin: "model_lead",
        artifact_verified: false
      };
      ctx.evidence.ventures.push(rec);
      return { v, rec };
    });
    ctx.emit({ phase: "P0 \xB7 Intake", label: "Affiliations discovered", detail: `${discovered.length} public affiliation${discovered.length === 1 ? "" : "s"} tied to the subject: ${discovered.slice(0, 5).map((v) => v.name).join(", ")}.`, source: "grok", tone: "good" });
    let corroboratedAffiliations = 0;
    await Promise.all(
      pending.slice(0, 5).map(async ({ v, rec }) => {
        const corrob = [];
        const subjectU = ctx.handle.replace(/^@/, "").toLowerCase();
        const xHandle = v.x_handle ?? (v.evidence?.match(/@([A-Za-z0-9_]{2,30})/g) ?? []).map((s) => s.slice(1)).find((u) => u.toLowerCase() !== subjectU);
        const domain2 = v.domain ?? v.evidence?.match(/\b([a-z0-9][a-z0-9-]*\.(?:xyz|io|com|fi|app|finance|org|net|co|ai|gg|so))\b/i)?.[1];
        try {
          if (domain2) {
            const arch = await archivedAffiliation(domain2, ctx.evidence.profile.display_name);
            if (arch) {
              corrob.push(`archived ${arch.where} page (${arch.year})`);
              rec.evidence_url = arch.url;
            }
          }
          if (xHandle) {
            const follows = await followsSubject("@" + xHandle.replace(/^@/, ""), ctx.handle);
            if (follows) corrob.push(`@${xHandle.replace(/^@/, "")} follows the subject`);
          }
        } catch {
        }
        if (corrob.length) {
          corroboratedAffiliations += 1;
          rec.notes = [v.evidence, `corroborated: ${corrob.join("; ")}`].filter(Boolean).join(" \xB7 ");
          ctx.emit({ phase: "P0 \xB7 Intake", label: `Affiliation corroborated \xB7 ${v.name}`, detail: `${v.role}${v.year ? `, ${v.year}` : ""}: ${corrob.join("; ")}.`, source: "argus", tone: "good" });
        }
      })
    );
    if (corroboratedAffiliations) {
      ctx.recordCheck?.({
        id: "affiliations-associates",
        status: "confirmed",
        note: `${corroboratedAffiliations} discovered affiliation${corroboratedAffiliations === 1 ? "" : "s"} corroborated against an independent artifact or follow-graph result`,
        provider: "wayback/twitterapi.io",
        sourceCount: corroboratedAffiliations
      });
    }
  } else {
    ctx.emit({ phase: "P0 \xB7 Intake", label: "No affiliations found", detail: "No public company affiliations could be attributed to this person via web/X search.", source: "grok", tone: "neutral" });
  }
}
function axisCatalog(roles) {
  const out = [];
  for (const role of roles) {
    const prof = getProfile(role);
    for (const [axis, weight] of Object.entries(prof.axes)) {
      out.push({ axis, weight, role });
    }
  }
  return out;
}
function providerBackedRoles(evidence) {
  const roles = /* @__PURE__ */ new Set();
  if (evidence.profile.profile_collection_state === "resolved" && evidence.profile.bio.trim()) {
    const profileRoles = classifySubject(evidence.profile.bio).applicable_classes;
    const providerCapturedAt = Date.parse(evidence.profile.profile_captured_at ?? "");
    const officialSite = canonicalOfficialWebsite(evidence.profile.website);
    const projectProfileVerified = evidence.profile.profile_provider === "twitterapi" && Number.isFinite(providerCapturedAt) && officialSite !== null;
    profileRoles.forEach((role) => {
      if (role !== "PROJECT" /* PROJECT */ || projectProfileVerified) roles.add(role);
    });
  }
  for (const venture of evidence.ventures) {
    if (venture.evidence_origin === "model_lead" || venture.artifact_verified !== true) continue;
    const role = (venture.role ?? "").toLowerCase();
    if (/founder|co-?founder|\bceo\b|\bcto\b|creator|owner/.test(role)) roles.add("FOUNDER" /* FOUNDER */);
    else if (/advisor|adviser|board/.test(role)) roles.add("ADVISOR" /* ADVISOR */);
    else if (/investor|partner|principal|venture|capital|\bgp\b/.test(role)) roles.add("INVESTOR" /* INVESTOR */);
    else if (/contributor|engineer|developer|employee|manager|director|lead|role on record/.test(role)) roles.add("MEMBER" /* MEMBER */);
  }
  if (evidence.clientEngagements.some((row) => row.evidence_origin !== "model_lead" && row.artifact_verified === true)) {
    roles.add("AGENCY" /* AGENCY */);
  }
  if (evidence.projectToken?.verified === true) {
    roles.add("PROJECT" /* PROJECT */);
  }
  if (roles.has("INVESTOR" /* INVESTOR */) && !evidence.projectToken?.verified) {
    roles.delete("PROJECT" /* PROJECT */);
  }
  return [...roles];
}
function projectVerifiedBasicFacts(ctx) {
  if (!providerBackedRoles(ctx.evidence).includes("PROJECT" /* PROJECT */)) return;
  const facts = (ctx.evidence.basicFacts ?? []).filter(
    (fact) => fact.artifact_verified === true && (fact.status === "verified" || fact.status === "corroborated")
  );
  if (!facts.length) return;
  const norm2 = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const normHandle = (value) => value.trim().replace(/^@/, "").toLowerCase();
  const subjectHandle = normHandle(ctx.handle);
  const citedPersonHandle = (fact) => {
    const handles = /* @__PURE__ */ new Set();
    const escapedName = fact.value.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!escapedName) return void 0;
    const nameThenHandle = new RegExp(
      `${escapedName}\\s*(?:\\(\\s*|\\[\\s*)?@([A-Za-z0-9_]{2,30})\\b`,
      "gi"
    );
    const handleThenName = new RegExp(
      `@([A-Za-z0-9_]{2,30})\\s*(?:\\(\\s*|\\[\\s*)${escapedName}\\b`,
      "gi"
    );
    for (const source2 of fact.sources) {
      for (const match of source2.excerpt.matchAll(nameThenHandle)) {
        handles.add(normHandle(match[1]));
      }
      for (const match of source2.excerpt.matchAll(handleThenName)) {
        handles.add(normHandle(match[1]));
      }
    }
    handles.delete(subjectHandle);
    return handles.size === 1 ? [...handles][0] : void 0;
  };
  const roster = ctx.evidence.webTeam ?? (ctx.evidence.webTeam = []);
  const people = facts.filter((fact) => fact.predicate === "founder" || fact.predicate === "executive");
  for (const fact of people) {
    const citedHandle = citedPersonHandle(fact);
    const existing = roster.find((member) => norm2(member.name) === norm2(fact.value) || Boolean(citedHandle && member.handle && normHandle(member.handle) === citedHandle));
    if (existing) continue;
    const source2 = fact.sources.find((candidate) => candidate.relation === "supports") ?? fact.sources[0];
    if (!source2) continue;
    roster.push({
      name: fact.value,
      ...citedHandle ? { handle: `@${citedHandle}`, identity_link_evidence_origin: "deterministic" } : {},
      role: fact.qualifier ?? (fact.predicate === "founder" ? "Founder" : "Executive"),
      evidence: source2.excerpt,
      source: source2.title ?? (source2.sourceClass === "official_subject" ? "Official project source" : "Corroborated public sources"),
      sourceUrl: source2.url,
      evidence_origin: "deterministic",
      artifact_verified: true,
      provider: "basic-facts-web"
    });
  }
  if (people.length) {
    const peopleSourceCount = people.reduce((total, fact) => total + fact.sources.length, 0);
    if (ctx.evidence.profile.identity_confidence !== "SuspectedImpersonation" && ctx.evidence.profile.identity_confidence === "Unverified") {
      ctx.evidence.profile.identity_confidence = "Probable";
    }
    ctx.recordCheck?.({
      id: "identity-resolution",
      status: "confirmed",
      note: `project identity resolved through ${people.length} founder or executive record${people.length === 1 ? "" : "s"} verified from fetched, cited public sources`,
      provider: "basic-facts-web",
      sourceCount: peopleSourceCount
    });
    ctx.recordCheck?.({
      id: "affiliations-associates",
      status: "confirmed",
      note: `${people.length} project team affiliation${people.length === 1 ? " was" : "s were"} verified from fetched, cited public sources`,
      provider: "basic-facts-web",
      sourceCount: peopleSourceCount
    });
    ctx.recordCheck?.({
      id: "project-team-identity",
      status: "confirmed",
      note: `${people.length} founder or executive record${people.length === 1 ? " was" : "s were"} verified from fetched, cited public sources`,
      provider: "basic-facts-web",
      sourceCount: peopleSourceCount
    });
  }
  const products = facts.filter((fact) => fact.predicate === "product");
  if (products.length) {
    ctx.recordCheck?.({
      id: "project-product-substance",
      status: "confirmed",
      note: `${products.length} core product description${products.length === 1 ? " was" : "s were"} verified from fetched, cited public sources`,
      provider: "basic-facts-web",
      sourceCount: products.reduce((total, fact) => total + fact.sources.length, 0)
    });
  }
  const traction = facts.filter((fact) => fact.predicate === "traction");
  if (traction.length) {
    ctx.recordCheck?.({
      id: "project-traction-liveness",
      status: "confirmed",
      note: `${traction.length} concrete traction or usage metric${traction.length === 1 ? " was" : "s were"} verified from fetched, cited public sources`,
      provider: "basic-facts-web",
      sourceCount: traction.reduce((total, fact) => total + fact.sources.length, 0)
    });
  }
}
var FOUNDER_DECISION_QUESTION_GROUPS = [
  {
    id: "founder-identity-authority",
    predicates: ["official_identity", "current_role"],
    answerMode: "all",
    answeredNote: "identity and current decision-making role are both tied to verified evidence",
    emptyNote: "the source search completed without verifying both identity and current authority"
  },
  {
    id: "founder-company-relationships",
    predicates: ["founder", "current_role"],
    answerMode: "all",
    answeredNote: "founded companies and current operating relationships are tied to verified evidence",
    emptyNote: "the source search completed without verifying both founded companies and current operating relationships"
  },
  {
    id: "founder-track-record",
    predicates: ["track_record", "exit", "prior_role", "founded", "product", "launched", "traction"],
    answerMode: "any",
    answeredNote: "at least one prior role, founded venture, shipped product, traction result, venture outcome, or exit is tied to verified evidence",
    emptyNote: "the source search completed without a publishable prior role, founded venture, shipped product, traction result, venture outcome, or exit"
  },
  {
    id: "founder-control-conflicts",
    predicates: ["control", "conflict_of_interest", "governance"],
    answerMode: "any",
    answeredNote: "at least one control, governance, or conflict disclosure is tied to verified evidence",
    emptyNote: "the source search completed without a publishable control or conflict disclosure; this is a gap, not a clean screen"
  },
  {
    id: "founder-legal-regulatory",
    predicates: ["legal_regulatory_event"],
    answerMode: "any",
    answeredNote: "a material legal or regulatory event is tied to its explicitly named subject and stated status",
    emptyNote: "the source search completed without a verified event explicitly naming this person; this is not legal clearance"
  },
  {
    id: "founder-asset-distinction",
    predicates: ["public_security", "official_token"],
    answerMode: "any",
    answeredNote: "every observed security or token claim is classified and verified in its own asset category",
    emptyNote: "no security or token claim entered the frozen evidence set, so asset classification was not applicable"
  }
];
function collectFounderDecisionQuestionOutcomes(ctx) {
  if (!ctx.evidence.roles.includes("FOUNDER" /* FOUNDER */)) return;
  const ledger = ctx.evidence.basicFactQuestionLedger ?? [];
  if (!ledger.length) return;
  const verifiedFacts = (ctx.evidence.basicFacts ?? []).filter(
    (fact) => fact.artifact_verified === true && (fact.status === "verified" || fact.status === "corroborated")
  );
  for (const group of FOUNDER_DECISION_QUESTION_GROUPS) {
    const entries = group.predicates.map((predicate) => ledger.find((entry) => entry.predicate === predicate)).filter((entry) => Boolean(entry));
    if (!entries.length) continue;
    const ledgerAnswered = group.answerMode === "all" ? group.predicates.every((predicate) => entries.some((entry) => entry.predicate === predicate && entry.status === "answered")) : entries.some((entry) => entry.status === "answered");
    const facts = verifiedFacts.filter((fact) => group.predicates.includes(fact.predicate) && (group.id !== "founder-legal-regulatory" || fact.attributionScope === "direct_subject"));
    if (group.id === "founder-asset-distinction") {
      const assetOutcomes = group.predicates.map((predicate) => {
        const entry = entries.find((candidate) => candidate.predicate === predicate);
        const fact = facts.find((candidate) => candidate.predicate === predicate);
        const verifiedProjectToken = predicate === "official_token" ? ctx.evidence.projectToken?.verified ? ctx.evidence.projectToken : ctx.evidence.ventureToken?.verified ? ctx.evidence.ventureToken : null : null;
        const claimObserved = Boolean(
          fact || verifiedProjectToken || (ctx.evidence.basicFactLeads ?? []).some((lead) => lead.predicate === predicate) || entry?.status === "answered"
        );
        const outcome = fact || verifiedProjectToken ? "verified" : entry?.status === "unanswered" && basicFactQuestionOutcome(entry) === "checked_empty" ? "checked_empty" : claimObserved ? "unresolved" : "not_applicable";
        const label = predicate === "public_security" ? "Public security" : "Official crypto token";
        const verifiedValue = fact?.value ?? (verifiedProjectToken ? `$${verifiedProjectToken.symbol}` : "");
        return {
          predicate,
          outcome,
          note: outcome === "verified" ? `${label}: ${verifiedValue} verified` : outcome === "checked_empty" ? `${label}: completed search found no verified asset` : outcome === "not_applicable" ? `${label}: not applicable because no claim or candidate was observed in the frozen person/founder evidence` : `${label}: unresolved`
        };
      });
      const unresolvedAssets = assetOutcomes.filter((outcome) => outcome.outcome === "unresolved");
      const applicableAssets = assetOutcomes.filter((outcome) => outcome.outcome !== "not_applicable");
      const sourceCount = facts.reduce((count, fact) => count + fact.sources.length, 0);
      ctx.recordCheck?.({
        id: group.id,
        status: unresolvedAssets.length ? "unavailable" : applicableAssets.some((outcome) => outcome.outcome === "verified") ? "confirmed" : applicableAssets.some((outcome) => outcome.outcome === "checked_empty") ? "checked-empty" : "not-applicable",
        note: `${assetOutcomes.map((outcome) => outcome.note).join("; ")}. ${unresolvedAssets.length ? "Each observed asset claim must be verified in its own category before this distinction is complete." : applicableAssets.length ? "Every observed asset was classified separately. A not-applicable category is not a provider-backed negative finding." : "No asset claim entered the frozen evidence set, so this classification check does not govern readiness."}`,
        provider: "basic-facts-question-ledger",
        sourceCount
      });
      continue;
    }
    const answered = ledgerAnswered && (group.id !== "founder-legal-regulatory" || facts.length > 0);
    const completedSearch = entries.every((entry) => entry.providerRuns.some(
      (run) => run.state === "succeeded" || run.state === "completed_empty"
    ));
    if (answered) {
      const hasAttributedConcern = facts.some(
        (fact) => fact.predicate === "legal_regulatory_event" || fact.predicate === "conflict_of_interest"
      );
      ctx.recordCheck?.({
        id: group.id,
        status: hasAttributedConcern ? "finding" : "confirmed",
        note: group.answeredNote,
        provider: "basic-facts-question-ledger",
        sourceCount: facts.reduce((count, fact) => count + fact.sources.length, 0)
      });
      continue;
    }
    ctx.recordCheck?.({
      id: group.id,
      status: completedSearch ? "checked-empty" : "unavailable",
      note: completedSearch ? group.emptyNote : `${group.emptyNote}; one or more targeted search passes were partial, failed, or unavailable`,
      provider: "basic-facts-question-ledger",
      sourceCount: 0
    });
  }
}
var PROJECT_BACKING_ROLE = /\b(?:advisor|adviser|backer|investor)\b/i;
var PROJECT_BACKING_PROVIDERS = /* @__PURE__ */ new Set(["team-page", "twitterapi"]);
var PROJECT_TRANSPARENCY_FACT_PREDICATES = /* @__PURE__ */ new Set([
  "legal_entity",
  "governance",
  "tokenomics",
  "vesting",
  "treasury",
  "audit",
  "repository"
]);
function collectProjectCoreEvidenceOutcomes(ctx, options = {}) {
  if (!ctx.evidence.roles.includes("PROJECT" /* PROJECT */)) {
    return { state: "skipped", detail: "not a provider-backed project role" };
  }
  const verifiedBackers = (ctx.evidence.webTeam ?? []).slice(0, 32).filter(
    (member) => member.artifact_verified === true && member.evidence_origin !== "model_lead" && !!member.provider && PROJECT_BACKING_PROVIDERS.has(member.provider) && PROJECT_BACKING_ROLE.test(member.role)
  );
  const verifiedInvestorFacts = (ctx.evidence.basicFacts ?? []).filter(
    (fact) => fact.predicate === "investor" && fact.artifact_verified === true && (fact.status === "verified" || fact.status === "corroborated")
  );
  const backingCount = verifiedBackers.length + verifiedInvestorFacts.length;
  if (backingCount) {
    const providers = [.../* @__PURE__ */ new Set([
      ...verifiedBackers.map((member) => member.provider),
      ...verifiedInvestorFacts.length ? ["basic-facts-web"] : []
    ])];
    ctx.recordCheck?.({
      id: "project-backing-partners",
      status: "confirmed",
      note: `${backingCount} named advisor, backer, or investor record${backingCount === 1 ? " was" : "s were"} verified from fetched public evidence; funding terms and institutional investment were not inferred beyond these named records`,
      provider: providers.join("/"),
      sourceCount: verifiedBackers.length + verifiedInvestorFacts.reduce((total, fact) => total + fact.sources.length, 0)
    });
  } else {
    ctx.recordCheck?.({
      id: "project-backing-partners",
      status: "checked-empty",
      note: "bounded scan of up to 32 frozen first-party team and account records found no verified financial backer, investor, or advisor; product partnerships require separate source verification, and model-only leads were excluded",
      provider: "project-core-evidence"
    });
  }
  const verifiedDisclosures = (ctx.evidence.basicFacts ?? []).filter(
    (fact) => PROJECT_TRANSPARENCY_FACT_PREDICATES.has(fact.predicate) && fact.artifact_verified === true && (fact.status === "verified" || fact.status === "corroborated")
  );
  if (verifiedDisclosures.length) {
    ctx.recordCheck?.({
      id: "project-transparency",
      status: "confirmed",
      note: `${verifiedDisclosures.length} legal, governance, token-economic, repository, or security disclosure${verifiedDisclosures.length === 1 ? " was" : "s were"} verified against fetched, cited public sources`,
      provider: "basic-facts-web",
      sourceCount: verifiedDisclosures.reduce((total, fact) => total + fact.sources.length, 0)
    });
  } else if (options.transparencySearchExplicitlyEmpty) {
    ctx.recordCheck?.({
      id: "project-transparency",
      status: "checked-empty",
      note: "bounded disclosure search completed with an explicit no-match; no source-linked legal, governance, token-economic, repository, or security disclosure candidate was returned",
      provider: "basic-facts-web"
    });
  } else {
    ctx.recordCheck?.({
      id: "project-transparency",
      status: "unavailable",
      note: "no fetched governance or direct audit-report source passed verification; canonical token identity alone does not establish transparency",
      provider: "project-disclosure-collector"
    });
  }
  return {
    state: "partial",
    detail: `bounded frozen-evidence scan completed with ${backingCount} verified backing record${backingCount === 1 ? "" : "s"} and ${verifiedDisclosures.length} verified disclosure record${verifiedDisclosures.length === 1 ? "" : "s"}`
  };
}
function recordProjectTokenDrawdownFinding(evidence) {
  const token = evidence.projectToken;
  const drawdownPct = token?.history?.drawdownPct;
  const historySourceUrl = token?.history?.sourceUrl;
  if (!token || typeof drawdownPct !== "number" || !Number.isFinite(drawdownPct) || drawdownPct > -70 || !historySourceUrl) {
    return false;
  }
  if (evidence.findings.some(
    (finding) => finding.finding_type === "ProjectTokenDrawdown" && finding.source_url === historySourceUrl
  )) return false;
  const timeframe = token.history.timeframe === "hour" ? "hourly" : "daily";
  evidence.findings.push({
    finding_type: "ProjectTokenDrawdown",
    claim: `$${token.symbol} recorded a verified ${Math.abs(drawdownPct).toFixed(1)}% peak-to-latest drawdown in the captured GeckoTerminal ${timeframe} OHLCV window. CoinGecko and DexScreener established canonical token and pool context; price drawdown alone does not establish misconduct.`,
    source_url: historySourceUrl,
    source_date: token.capturedAt,
    source_author: "geckoterminal",
    verification_status: "Verified",
    independent_source_count: 1,
    polarity: -1,
    evidence_origin: "deterministic",
    artifact_verified: true
  });
  return true;
}
var handleFrom = (s) => s?.match(/@([A-Za-z0-9_]{2,30})/)?.[1];
function adverseSignalToFinding(sig) {
  const hasCandidateArtifact = !!sig.source_url;
  return {
    finding_type: "AdverseLead",
    claim: `${sig.target_entity_key} (${sig.category.replace(/_/g, " ")} lead): ${sig.claim}`,
    source_url: sig.source_url ?? "",
    source_date: "",
    source_author: sig.source,
    // A model-returned URL is a candidate to fetch, not a verified report about
    // the subject. Keep the trust label honest until a deterministic collector
    // retrieves the page and confirms that it supports the claim.
    verification_status: "Rumor",
    independent_source_count: hasCandidateArtifact ? 1 : 0,
    polarity: -1,
    evidence_origin: "model_lead",
    artifact_verified: false,
    finding_scope: {
      scope: sig.relationship_to_subject === "self" ? "direct_subject" : "related_entity",
      target_entity_key: sig.target_entity_key,
      target_entity_type: sig.target_entity_type,
      relationship_to_subject: sig.relationship_to_subject,
      relationship_label: sig.relationship_label
    }
  };
}
async function adverseSignalsAndTooling(ctx) {
  const { evidence } = ctx;
  const self = ctx.handle.replace(/^@/, "").toLowerCase();
  const ticker = evidence.promotions.find((p) => p.ticker)?.ticker;
  const subjectKind = evidence.roles.includes("PROJECT" /* PROJECT */) ? "project" : "person";
  const projectTargets = evidence.ventures.map((v) => ({
    name: v.project_name,
    role: v.role,
    handle: (v.x_handle ? v.x_handle.replace(/^@/, "") : void 0) ?? handleFrom(v.evidence_url) ?? handleFrom(v.notes)
  })).filter((v) => v.handle && v.handle.toLowerCase() !== self).slice(0, 4);
  const associateTargets = evidence.associates.map((a) => ({ handle: a.associate_handle, relation: a.relation })).filter((a) => a.handle && a.handle.replace(/^@/, "").toLowerCase() !== self).slice(0, 4);
  ctx.emit({ phase: "Adverse", label: "Scam / rug sweep", detail: `Searching for rug, slow-rug, liquidity-pull, drain, and FUD signals across the subject${ticker ? `, $${ticker.replace(/^\$/, "")}` : ""}, ${projectTargets.length} project${projectTargets.length === 1 ? "" : "s"}, and ${associateTargets.length} associate${associateTargets.length === 1 ? "" : "s"}\u2026`, source: "grok", tone: "neutral" });
  const [tooling, subjectSigs, projectSigs, assocSigs, ventureTeams] = await Promise.all([
    detectManipulationTooling(ctx.handle, evidence.profile.display_name),
    searchAdverseSignals(ctx.handle, subjectKind, {
      relationship_to_subject: "self",
      relationship_label: "audited subject"
    }, ticker),
    Promise.all(projectTargets.map((p) => searchAdverseSignals(p.handle, "project", {
      relationship_to_subject: "venture",
      relationship_label: [p.role, p.name].filter(Boolean).join(" at ") || p.name
    }))),
    Promise.all(associateTargets.map((a) => searchAdverseSignals(a.handle, "person", {
      relationship_to_subject: "associate",
      relationship_label: a.relation || "recorded associate"
    }))),
    projectTargets.length >= 2 ? Promise.all(projectTargets.map((p) => findTeam(p.handle, p.name))) : Promise.resolve([])
  ]);
  if (tooling?.tools.length) {
    const list = tooling.tools.map((t) => `${t.name} (${t.kind.replace(/_/g, " ")})`).join(", ");
    const candidateUrl = tooling.tools.find((t) => t.url)?.url;
    evidence.findings.push({
      finding_type: "ManipulationToolingLead",
      claim: `Model-discovered lead: subject may be connected as ${tooling.role_claim || "operator"} to manipulation tooling: ${list}.`,
      source_url: candidateUrl ?? "",
      source_date: "",
      source_author: "model-discovered candidate page",
      verification_status: candidateUrl ? "Reported" : "Rumor",
      independent_source_count: candidateUrl ? 1 : 0,
      polarity: -1,
      evidence_origin: "model_lead",
      artifact_verified: false,
      finding_scope: {
        scope: "direct_subject",
        target_entity_key: `@${self}`,
        target_entity_type: subjectKind,
        relationship_to_subject: "self",
        relationship_label: "audited subject"
      }
    });
    for (const t of tooling.tools) {
      evidence.clientEngagements.push({
        client_name: t.name,
        service_type: `possible_manipulation_tooling:${t.kind}`,
        manipulation_service_flag: false,
        evidence_url: t.url,
        notes: [t.evidence, "model-discovered lead; relationship not independently verified"].filter(Boolean).join(" \xB7 "),
        evidence_origin: "model_lead",
        artifact_verified: false
      });
    }
    ctx.emit({ phase: "Adverse", label: "Manipulation-tooling lead", detail: `Candidate connection surfaced for ${list}; independent artifact verification is still required before this can affect a hard cap.`, source: "grok", tone: "warn" });
  }
  const pushSigs = (sigs) => {
    for (const s of sigs) {
      evidence.findings.push(adverseSignalToFinding(s));
    }
  };
  let totalSigs = 0;
  pushSigs(subjectSigs);
  totalSigs += subjectSigs.length;
  projectSigs.forEach((sigs) => {
    pushSigs(sigs);
    totalSigs += sigs.length;
  });
  assocSigs.forEach((sigs) => {
    pushSigs(sigs);
    totalSigs += sigs.length;
  });
  if (totalSigs) {
    const top = [...subjectSigs, ...projectSigs.flat(), ...assocSigs.flat()].slice(0, 3).map((s) => `${s.relationship_to_subject} ${s.target_entity_key} \xB7 ${s.category.replace(/_/g, " ")}: ${s.claim}`).join(" \xB7 ");
    ctx.emit({ phase: "Adverse", label: `${totalSigs} adverse lead${totalSigs === 1 ? "" : "s"}`, detail: `Unverified candidate sources for follow-up. ${top}`, source: "grok", tone: "warn" });
  } else {
    ctx.emit({ phase: "Adverse", label: "No adverse leads surfaced", detail: "The model search returned no candidate rug/scam/drain/FUD source URLs for follow-up; this is not proof that none exist.", source: "grok", tone: "neutral" });
  }
  if (projectTargets.length >= 2) {
    ctx.evidence.ventureTeams = projectTargets.map((p, i) => ({
      key: canonicalEntityKey({ handle: p.handle, name: p.name }),
      name: p.name,
      people: (ventureTeams[i] ?? []).filter((m) => (m.handle || m.name) && m.handle?.replace(/^@/, "").toLowerCase() !== self).slice(0, 8).map((m) => ({ name: m.name, handle: m.handle, role: m.role })),
      provider: "grok",
      evidence_origin: "model_lead",
      artifact_verified: false
    })).filter((vt) => vt.people.length > 0);
    if (ctx.evidence.ventureTeams.length) {
      const total = ctx.evidence.ventureTeams.reduce((n, vt) => n + vt.people.length, 0);
      ctx.emit({ phase: "Network", label: "Venture teams mapped", detail: `${total} people across ${ctx.evidence.ventureTeams.length} venture${ctx.evidence.ventureTeams.length === 1 ? "" : "s"} wired into the graph: subject \u2192 venture \u2192 the people behind it.`, source: "grok", tone: "good" });
    }
    const appearances = /* @__PURE__ */ new Map();
    ventureTeams.forEach((team, i) => {
      for (const member of team) {
        if (!member.handle) continue;
        const key = member.handle.replace(/^@/, "").toLowerCase();
        if (key === self) continue;
        const rec = appearances.get(key) ?? { name: member.name, projects: /* @__PURE__ */ new Set() };
        rec.projects.add(projectTargets[i].name);
        appearances.set(key, rec);
      }
    });
    const overlaps = [...appearances.entries()].filter(([, r]) => r.projects.size >= 2);
    if (overlaps.length) {
      const haveAssoc = new Set(evidence.associates.map((a) => a.associate_handle.replace(/^@/, "").toLowerCase()));
      for (const [key, r] of overlaps) {
        const projList = [...r.projects].join(", ");
        if (haveAssoc.has(key)) {
          const existing = evidence.associates.find((a) => a.associate_handle.replace(/^@/, "").toLowerCase() === key);
          if (existing?.evidence_origin === "model_lead") {
            existing.notes = [existing.notes, `also on: ${projList}`].filter(Boolean).join(" \xB7 ");
          } else {
            evidence.associates.push({
              associate_handle: "@" + key,
              relation: "cross-project overlap",
              notes: `appears across ${projList}`,
              provider: "grok",
              evidence_origin: "model_lead",
              artifact_verified: false
            });
          }
        } else {
          evidence.associates.push({
            associate_handle: "@" + key,
            relation: "cross-project overlap",
            notes: `appears across ${projList}`,
            provider: "grok",
            evidence_origin: "model_lead",
            artifact_verified: false
          });
        }
      }
      ctx.emit({ phase: "Adverse", label: `${overlaps.length} cross-project overlap${overlaps.length === 1 ? "" : "s"}`, detail: overlaps.slice(0, 5).map(([k, r]) => `@${k} (${[...r.projects].join(", ")})`).join(" \xB7 "), source: "grok", tone: "warn" });
    }
  }
}
async function tokenLifecycle(ctx) {
  const { evidence } = ctx;
  const promos = evidence.promotions.filter((p) => p.ticker && p.contract_address).slice(0, 3);
  if (!promos.length) return;
  await Promise.all(
    promos.map(async (p) => {
      const sig = await detectTokenLifecycle(p.ticker, p.contract_address);
      if (!sig) return;
      ctx.recordCheck?.({
        id: "promoted-token-performance",
        status: sig.dive ? "finding" : "confirmed",
        note: sig.dive ? `$${sig.ticker} verified contract collapse: ${sig.dive.detail}` : `$${sig.ticker} lifecycle lookup completed with no collapse surfaced`,
        provider: "dexscreener",
        sourceCount: 1
      });
      if (!sig.dive) return;
      evidence.findings.push({
        finding_type: "TokenCollapse",
        claim: `$${sig.ticker} (${p.contract_address.slice(0, 8)}\u2026) launched and collapsed to near-zero (${sig.dive.detail}).`,
        source_url: `https://dexscreener.com/search?q=${encodeURIComponent(sig.dive.address)}`,
        source_date: "",
        source_author: "dexscreener",
        verification_status: "Verified",
        independent_source_count: 1,
        polarity: -1,
        evidence_origin: "deterministic",
        artifact_verified: true
      });
      ctx.emit({ phase: "Token", label: `$${sig.ticker} collapse`, detail: `${sig.dive.detail}. The dive-after-launch pattern.`, source: "dexscreener", tone: "bad" });
    })
  );
}
async function postCadence(ctx) {
  const posts = await getRecentPostsMeta(ctx.handle);
  const report = analyzeCadence(posts, Date.now());
  if (!report) return;
  ctx.recordCheck?.({
    id: "project-traction-liveness",
    status: report.silent || report.decaying ? "finding" : "confirmed",
    note: report.summary,
    provider: "twitterapi.io",
    sourceCount: posts.length
  });
  if (report.silent || report.decaying) {
    ctx.evidence.findings.push({
      finding_type: "CadenceDecay",
      claim: `@${ctx.handle.replace(/^@/, "")}: ${report.summary}`,
      source_url: "",
      source_date: "",
      source_author: "twitterapi.io",
      verification_status: "Verified",
      independent_source_count: 1,
      polarity: -1,
      evidence_origin: "deterministic",
      artifact_verified: true
    });
    ctx.emit({ phase: "Cadence", label: report.silent ? "Went quiet" : "Cadence thinning", detail: report.summary, source: "twitterapi.io", tone: report.silent ? "bad" : "warn" });
  } else {
    ctx.emit({ phase: "Cadence", label: "Posting steady", detail: report.summary, source: "twitterapi.io", tone: "neutral" });
  }
}
var fixtureDiscoveryNote = (existing, claims) => [
  existing?.trim(),
  claims.length ? `Fixture discovery claim (unverified; requires a fresh provider re-check): ${claims.join("; ")}` : "Fixture discovery claim (unverified; requires a fresh provider re-check)."
].filter(Boolean).join(" \xB7 ");
function downgradeFixtureEvidenceForLive(seed) {
  const handleLabel = seed.profile.handle.replace(/^@/, "") || "unknown";
  return {
    ...seed,
    roles: [],
    profile: {
      // A fixture profile is also a claim seed. Mutable public metadata and
      // resolved identity fields must be recollected; otherwise an unrelated
      // configured provider could make stale fixture identity look current.
      handle: seed.profile.handle,
      display_name: handleLabel,
      avatar: handleLabel.slice(0, 1).toUpperCase(),
      bio: "",
      followers: "N/A",
      joined: "N/A",
      identity_confidence: "Unverified",
      identity_note: "Fixture discovery seed only; identity requires a fresh provider re-check.",
      profile_collection_state: "unavailable",
      profile_provider: "twitterapi"
    },
    axes: [],
    headline: "",
    ventures: seed.ventures.map((venture) => ({
      ...venture,
      outcome: "Unknown" /* UNKNOWN */,
      acquirer: null,
      deal_type: null,
      deal_value_usd: null,
      investors: [],
      current_backers: [],
      evidence_origin: "model_lead",
      artifact_verified: false,
      notes: fixtureDiscoveryNote(venture.notes, [
        venture.outcome !== "Unknown" /* UNKNOWN */ ? `claimed outcome ${venture.outcome}` : "",
        venture.acquirer ? `claimed acquirer ${venture.acquirer}` : "",
        venture.investors?.length ? `claimed investors ${venture.investors.join(", ")}` : "",
        venture.current_backers?.length ? `claimed current backers ${venture.current_backers.join(", ")}` : ""
      ].filter(Boolean))
    })),
    testimonials: seed.testimonials.map((testimonial) => ({
      ...testimonial,
      public_acknowledgment: null,
      follows_subject: null,
      relationship_corroborated: null,
      sentiment: null,
      fud_present: false,
      corroboration_verdict: void 0,
      evidence_origin: "model_lead",
      artifact_verified: false,
      notes: fixtureDiscoveryNote(testimonial.notes, [
        testimonial.public_acknowledgment ? `claimed acknowledgment ${testimonial.public_acknowledgment}` : "",
        testimonial.relationship_corroborated ? "claimed relationship corroboration" : "",
        testimonial.follows_subject === true ? "claimed follow" : testimonial.follows_subject === false ? "claimed no follow" : "",
        testimonial.sentiment ? `claimed sentiment ${testimonial.sentiment}` : ""
      ].filter(Boolean))
    })),
    advised: seed.advised.map((project) => ({
      ...project,
      public_acknowledgment: null,
      follows_subject: null,
      relationship_corroborated: null,
      sentiment: null,
      fud_present: false,
      corroboration_verdict: void 0,
      project_outcome: "Unknown" /* UNKNOWN */,
      paid_or_allocated: void 0,
      evidence_origin: "model_lead",
      artifact_verified: false,
      notes: fixtureDiscoveryNote(project.notes, [
        project.public_acknowledgment ? `claimed acknowledgment ${project.public_acknowledgment}` : "",
        project.relationship_corroborated ? "claimed relationship corroboration" : "",
        project.project_outcome && project.project_outcome !== "Unknown" /* UNKNOWN */ ? `claimed project outcome ${project.project_outcome}` : "",
        project.paid_or_allocated ? "claimed paid role or allocation" : ""
      ].filter(Boolean))
    })),
    wallets: seed.wallets.map((wallet) => ({
      ...wallet,
      link_tier: "Inferred",
      activity_summary: void 0,
      sold_into_own_promo: void 0,
      scam_adjacent_flow: void 0,
      positive_signals: void 0,
      evidence_origin: "model_lead",
      artifact_verified: false,
      notes: fixtureDiscoveryNote(wallet.notes, [
        wallet.link_tier ? `claimed attribution ${wallet.link_tier}` : "",
        wallet.sold_into_own_promo ? "claimed sale into own promotion" : "",
        wallet.scam_adjacent_flow ? "claimed scam-adjacent flow" : ""
      ].filter(Boolean))
    })),
    promotions: seed.promotions.map((promotion) => ({
      ...promotion,
      paid_promo: void 0,
      outcome_was_rug: void 0,
      perf_current: void 0,
      evidence_origin: "model_lead",
      artifact_verified: false,
      notes: fixtureDiscoveryNote(promotion.notes, [
        promotion.paid_promo ? "claimed paid promotion" : "",
        promotion.outcome_was_rug ? "claimed rug outcome" : ""
      ].filter(Boolean))
    })),
    clientEngagements: seed.clientEngagements.map((engagement) => ({
      ...engagement,
      client_outcome: "Unknown" /* UNKNOWN */,
      manipulation_service_flag: void 0,
      evidence_origin: "model_lead",
      artifact_verified: false,
      notes: fixtureDiscoveryNote(engagement.notes, [
        engagement.client_outcome && engagement.client_outcome !== "Unknown" /* UNKNOWN */ ? `claimed client outcome ${engagement.client_outcome}` : "",
        engagement.manipulation_service_flag ? "claimed manipulation service" : ""
      ].filter(Boolean))
    })),
    findings: [
      ...seed.findings.map((finding) => ({
        ...finding,
        verification_status: "Rumor",
        independent_source_count: 0,
        evidence_origin: "model_lead",
        artifact_verified: false,
        content_hash: void 0,
        trust_graph: void 0
      })),
      ...seed.roles.map((role) => ({
        finding_type: "RoleCandidate",
        claim: `Fixture discovery suggests ${role}; provider corroboration is required before routing.`,
        source_url: "",
        source_date: "",
        source_author: "fixture-discovery",
        verification_status: "Rumor",
        independent_source_count: 0,
        polarity: 0,
        evidence_origin: "model_lead",
        artifact_verified: false,
        finding_scope: {
          scope: "direct_subject",
          target_entity_key: seed.profile.handle,
          target_entity_type: "person",
          relationship_to_subject: "self",
          relationship_label: "fixture role candidate"
        }
      }))
    ],
    // Fixture relationship and frozen-artifact collections are not wired to a
    // live re-verifier. Drop them instead of materializing stale graph edges or
    // letting old source snapshots enter a new analyst context.
    associates: [],
    recentActivity: [],
    notableFollowers: [],
    contradictions: [],
    sourceArtifacts: [],
    portfolioLeads: [],
    profileAuthenticity: void 0,
    trustGraphScreen: void 0,
    webTeam: [],
    ventureTeams: [],
    basicFacts: [],
    basicFactLeads: []
  };
}
async function runAuditWithLedger(rawHandle, emit, options) {
  const runtimeStartedAt = Date.now();
  const startRuntimeStage = (stage) => {
    const stageStartedAt = Date.now();
    console.info("[audit-runtime]", JSON.stringify({
      stage,
      state: "started",
      elapsedMs: stageStartedAt - runtimeStartedAt
    }));
    return stageStartedAt;
  };
  const finishRuntimeStage = (stage, stageStartedAt) => {
    console.info("[audit-runtime]", JSON.stringify({
      stage,
      state: "complete",
      stageMs: Date.now() - stageStartedAt,
      elapsedMs: Date.now() - runtimeStartedAt
    }));
  };
  const fixture = findSubject(rawHandle);
  const seededEvidence = fixture ? toEvidence(fixture) : null;
  const liveSeedEvidence = seededEvidence ? downgradeFixtureEvidenceForLive(seededEvidence) : null;
  const liveProviders = ADAPTERS.filter(
    (adapter) => KEYED.has(adapter.id) && adapter.available() && (!liveSeedEvidence || !adapter.applicable || adapter.applicable(liveSeedEvidence))
  );
  const anyLive = liveProviders.length > 0 || analystAvailable();
  if (fixture && !anyLive) {
    for (const step of fixture.trace) {
      emit(step);
      await delay(420 + Math.random() * 360);
    }
    await delay(500);
    const dossier2 = assembleDossier(seededEvidence, false);
    dossier2.checkRuns = personChecks({
      identityConfidence: dossier2.report.identity_confidence ?? void 0,
      realName: dossier2.display_name.trim().split(/\s+/).filter(Boolean).length >= 2,
      roles: dossier2.report.roles ?? [],
      hasAssociates: (dossier2.evidence.associates ?? []).length > 0
    });
    dossier2.completeness_state = "partial";
    dossier2.providerSnapshot = { capturedAt: (/* @__PURE__ */ new Date()).toISOString(), runs: [] };
    return dossier2;
  }
  const evidence = liveSeedEvidence ? liveSeedEvidence : emptyEvidence(rawHandle);
  const checkTracker = new PersonCheckTracker();
  const adapterResults = /* @__PURE__ */ new Map();
  emit({ phase: "P0 \xB7 Intake", label: "Resolve handle", detail: `Normalizing ${rawHandle} and opening the audit ledger.`, tone: "neutral" });
  const ctx = {
    handle: evidence.profile.handle,
    organizationId: options?.organizationId,
    evidence,
    emit,
    recordCheck: (observation) => checkTracker.record(observation)
  };
  const projectTokenPass = async () => {
    const providers = ["coingecko", "dexscreener", "geckoterminal"];
    const before = attemptTotals(providers);
    try {
      const result = await collectProjectTokenIdentity(ctx);
      const recordedDrawdown = recordProjectTokenDrawdownFinding(evidence);
      if (recordedDrawdown) {
        emit({
          phase: "Token",
          label: "Canonical token drawdown",
          detail: `${evidence.projectToken?.symbol ?? "Token"} market drawdown was frozen as traction counter-evidence; it is not treated as misconduct.`,
          source: "project-token-market",
          tone: "warn"
        });
      }
      const attempts = attemptDelta(before, attemptTotals(providers));
      const state = adapterRunState(result, attempts);
      checkTracker.provider(
        "project-token",
        "Canonical project token",
        state,
        result.detail ?? `${attempts.total} provider attempt${attempts.total === 1 ? "" : "s"} observed`
      );
    } catch (error) {
      checkTracker.provider("project-token", "Canonical project token", "failed", String(error));
      emit({ phase: "Token", label: "Project token resolution error", detail: String(error), tone: "warn" });
    }
  };
  if (!fixture) {
    const stageStartedAt = startRuntimeStage("cold-intake");
    await resolveProfile(ctx);
    await projectTokenPass();
    if (evidence.projectToken?.verified) {
      const projectName2 = evidence.projectToken.name;
      const capturedAt = evidence.projectToken.capturedAt;
      try {
        const [tvlOutcome, fundingOutcome, feesOutcome] = await Promise.all([
          collectProtocolTvl(projectName2),
          collectProtocolFunding(projectName2),
          collectProtocolFees(projectName2)
        ]);
        if (feesOutcome.available) evidence.protocolFees = { ...feesOutcome.value, capturedAt };
        if (tvlOutcome.available) {
          evidence.protocolTvl = { ...tvlOutcome.value, capturedAt };
          if (tvlOutcome.value.chains.length && tvlOutcome.value.geckoId && tvlOutcome.value.geckoId === evidence.projectToken.coingeckoId) {
            evidence.projectToken = { ...evidence.projectToken, deployedChains: tvlOutcome.value.chains };
          }
        }
        if (fundingOutcome.available) evidence.protocolFunding = { ...fundingOutcome.value, capturedAt };
        if (!fundingOutcome.available) {
          const enrichment = await withWallClockBox(
            collectCompanyEnrichment(projectName2, {
              sections: ["funding_detail", "management_profile", "firmographic"]
            }),
            MONID_ENRICHMENT_BUDGET_MS
          );
          if (enrichment?.available) evidence.companyEnrichment = { ...enrichment.value, capturedAt };
        }
      } catch (error) {
        emit({ phase: "Token", label: "Backing enrichment error", detail: String(error), tone: "warn" });
      }
    }
    evidence.roles = providerBackedRoles(evidence);
    await coldIntake(ctx, true);
    finishRuntimeStage("cold-intake", stageStartedAt);
  }
  for (const a of ADAPTERS) {
    if (!a.available()) {
      checkTracker.provider(a.id, a.label, "unavailable", "provider is not configured");
      if (a.id === "github") {
        checkTracker.record({
          id: "code-footprint-github",
          status: "unavailable",
          note: "GitHub provider is not configured",
          provider: "github"
        });
      }
      continue;
    }
    if (a.id === "basic-facts") evidence.roles = providerBackedRoles(evidence);
    const nameBeforeBasicFacts = a.id === "basic-facts" ? resolvedOffchainName(ctx) : null;
    const stageStartedAt = startRuntimeStage(`adapter:${a.id}`);
    try {
      const before = attemptTotals();
      const result = await a.run(ctx);
      if (result) adapterResults.set(a.id, result);
      const attempts = attemptDelta(before, attemptTotals());
      const state = adapterRunState(result, attempts);
      const detail = result?.detail ?? (state === "skipped" ? "no applicable provider call was observed" : `${attempts.total} provider attempt${attempts.total === 1 ? "" : "s"} observed`);
      checkTracker.provider(a.id, a.label, state, detail);
    } catch (e) {
      checkTracker.provider(a.id, a.label, "failed", String(e));
      if (a.id === "github") {
        checkTracker.record({ id: "code-footprint-github", status: "unavailable", note: `GitHub adapter failed: ${String(e)}`, provider: "github" });
      }
      emit({ phase: "Collect", label: `${a.label} error`, detail: String(e), tone: "warn" });
    }
    finishRuntimeStage(`adapter:${a.id}`, stageStartedAt);
    if (a.id === "basic-facts") {
      const resolvedName = resolvedOffchainName(ctx);
      if (resolvedName && resolvedName.toLowerCase() !== nameBeforeBasicFacts?.toLowerCase()) {
        const refreshStartedAt = startRuntimeStage("offchain-full-name-refresh");
        try {
          const refresh = await refreshResolvedNameOffchain(ctx);
          const prior = adapterResults.get("offchain-diligence");
          const states = [prior?.state, refresh.state].filter(
            (state2) => Boolean(state2 && state2 !== "skipped")
          );
          const failed = states.filter((state2) => state2 === "failed").length;
          const partial = states.filter((state2) => state2 === "partial").length;
          const state = states.length && failed === states.length ? "failed" : failed || partial ? "partial" : "executed";
          const combined = {
            state,
            detail: [prior?.detail, refresh.detail].filter(Boolean).join("; ")
          };
          adapterResults.set("offchain-diligence", combined);
          checkTracker.provider("offchain-diligence", offchainAdapter.label, combined.state, combined.detail);
        } catch (error) {
          checkTracker.provider("offchain-diligence", offchainAdapter.label, "partial", `full-name refresh failed: ${String(error)}`);
          emit({ phase: "Off-chain", label: "Full-name refresh error", detail: String(error), tone: "warn" });
        }
        finishRuntimeStage("offchain-full-name-refresh", refreshStartedAt);
      }
    }
  }
  if (fixture) {
    await projectTokenPass();
    evidence.roles = providerBackedRoles(evidence);
  }
  if (!fixture && !evidence.companyEnrichment && evidence.roles.includes("FOUNDER" /* FOUNDER */)) {
    const primaryVenture = deriveFounderVentureCandidate(evidence);
    emit({
      phase: "Founder",
      label: primaryVenture ? `Primary venture derived \xB7 ${primaryVenture.project_name}` : "No primary venture derived",
      detail: primaryVenture ? `Bridge keys: ${[primaryVenture.x_handle, primaryVenture.domain].filter(Boolean).join(" \xB7 ") || "none"}; used for financing enrichment and the related-asset token binding.` : "No verified venture row, venture-naming fact, or official-domain identity anchor agreed with a bio founder claim; the related-asset binding is skipped.",
      source: "argus-founder-assets",
      tone: primaryVenture ? "neutral" : "warn"
    });
    if (primaryVenture) {
      try {
        const enrichment = await withWallClockBox(
          collectCompanyEnrichment(primaryVenture.project_name.trim(), {
            sections: ["funding_detail", "firmographic"]
          }),
          MONID_ENRICHMENT_BUDGET_MS
        );
        if (enrichment?.available) {
          evidence.companyEnrichment = { ...enrichment.value, capturedAt: (/* @__PURE__ */ new Date()).toISOString() };
        }
      } catch (error) {
        emit({ phase: "Founder", label: "Venture financing enrichment error", detail: String(error), tone: "warn" });
      }
      if (!evidence.ventureToken && (primaryVenture.x_handle || primaryVenture.domain)) {
        try {
          const ventureToken = await collectVentureTokenIdentity({
            name: primaryVenture.project_name.trim(),
            ...primaryVenture.x_handle ? { xHandle: primaryVenture.x_handle } : {},
            ...primaryVenture.domain ? { domain: primaryVenture.domain } : {}
          });
          if (ventureToken) {
            evidence.ventureToken = ventureToken;
            emit({
              phase: "Founder",
              label: `Venture token resolved \xB7 $${ventureToken.symbol}`,
              detail: `${ventureToken.ventureName} matched by ${ventureToken.verification === "official_x" ? "official X account" : "official domain"}; frozen as the founder's related asset.`,
              source: "coingecko",
              tone: "good"
            });
            const verifiedSecurity = (evidence.basicFacts ?? []).some((fact) => fact.predicate === "public_security" && fact.artifact_verified === true && (fact.status === "verified" || fact.status === "corroborated"));
            const securityEntry = (evidence.basicFactQuestionLedger ?? []).find((entry) => entry.predicate === "public_security");
            if (!verifiedSecurity && securityEntry && securityEntry.status === "unanswered") {
              const screen = await screenSecRegistryForNames([
                ventureToken.ventureName,
                ventureToken.name,
                primaryVenture.project_name
              ]);
              if (screen === "empty") {
                securityEntry.providerRuns.push({ phase: "repair", provider: "sec-registry", state: "completed_empty" });
                emit({
                  phase: "Founder",
                  label: "Public-security registry screened",
                  detail: `No listed issuer for ${ventureToken.ventureName} in the US exchange registry; the security category closes as checked-empty.`,
                  source: "sec-registry",
                  tone: "neutral"
                });
              } else if (screen === "matched") {
                emit({
                  phase: "Founder",
                  label: "Public-security registry match",
                  detail: `${ventureToken.ventureName} matched a listed issuer name; the security category stays open for review.`,
                  source: "sec-registry",
                  tone: "warn"
                });
              } else {
                emit({
                  phase: "Founder",
                  label: "Public-security registry unavailable",
                  detail: "The US exchange registry could not be screened this run; the security category is unchanged.",
                  source: "sec-registry",
                  tone: "warn"
                });
              }
            }
          }
        } catch (error) {
          emit({ phase: "Founder", label: "Venture token resolution error", detail: String(error), tone: "warn" });
        }
      }
    }
  }
  projectProviderBackedBasicFacts(evidence);
  projectVerifiedBasicFacts(ctx);
  const trackedPass = (id, label, providers, work, onError) => {
    const before = attemptTotals(providers);
    return Promise.resolve().then(work).then(() => {
      const attempts = attemptDelta(before, attemptTotals(providers));
      const state = observedRunState(attempts);
      checkTracker.provider(
        id,
        label,
        state,
        state === "skipped" ? "no applicable provider call was observed" : `${attempts.total} provider attempt${attempts.total === 1 ? "" : "s"} observed`
      );
    }).catch((error) => {
      checkTracker.provider(id, label, "failed", String(error));
      onError(error);
    });
  };
  const signalPassesStartedAt = startRuntimeStage("signal-passes");
  const signalPasses = [
    trackedPass("token-lifecycle", "Promoted-token lifecycle", ["dexscreener"], () => tokenLifecycle(ctx), (e) => {
      emit({ phase: "Token", label: "Lifecycle error", detail: String(e), tone: "warn" });
    })
  ];
  if (env("TWITTERAPI_KEY")) {
    signalPasses.push(trackedPass("post-cadence", "Posting cadence", ["twitterapi"], () => postCadence(ctx), (e) => {
      emit({ phase: "Cadence", label: "Cadence error", detail: String(e), tone: "warn" });
    }));
  } else {
    checkTracker.provider("post-cadence", "Posting cadence", "unavailable", "twitterapi.io provider is not configured");
  }
  if (analystAvailable() || env("XAI_API_KEY")) {
    signalPasses.push(trackedPass("adverse-sweep", "Adverse-signal sweep", ["grok", "cache"], () => adverseSignalsAndTooling(ctx), (e) => {
      emit({ phase: "Adverse", label: "Sweep error", detail: String(e), tone: "warn" });
    }));
  } else {
    checkTracker.provider("adverse-sweep", "Adverse-signal sweep", "unavailable", "model search provider is not configured");
  }
  await Promise.all(signalPasses);
  finishRuntimeStage("signal-passes", signalPassesStartedAt);
  evidence.roles = providerBackedRoles(evidence);
  if (evidence.roles.length) {
    emit({ phase: "P0 \xB7 Routing", label: "Classify roles", detail: `Provider-backed evidence routed to ${evidence.roles.join(", ")}.`, tone: "neutral" });
  } else {
    emit({ phase: "P0 \xB7 Routing", label: "Role unresolved", detail: "No deterministic or provider-corroborated role evidence was collected. Model role candidates remain leads; the report will publish INCOMPLETE.", tone: "warn" });
  }
  collectFounderDecisionQuestionOutcomes(ctx);
  try {
    const projectOutcomes = collectProjectCoreEvidenceOutcomes(ctx, {
      transparencySearchExplicitlyEmpty: adapterResults.get("basic-facts")?.explicitEmptyChecks?.includes("project-transparency") === true
    });
    checkTracker.provider(
      "project-core-outcomes",
      "Project backing and disclosure evidence",
      projectOutcomes.state,
      projectOutcomes.detail
    );
  } catch (error) {
    const detail = `Project core evidence outcome scan failed: ${String(error)}`;
    checkTracker.provider("project-core-outcomes", "Project backing and disclosure evidence", "failed", detail);
    if (evidence.roles.includes("PROJECT" /* PROJECT */)) {
      checkTracker.record({ id: "project-backing-partners", status: "unavailable", note: detail, provider: "project-core-evidence" });
      checkTracker.record({ id: "project-transparency", status: "unavailable", note: detail, provider: "project-disclosure-collector" });
    }
  }
  if (evidence.roles.includes("INVESTOR" /* INVESTOR */)) {
    const portfolioStartedAt = startRuntimeStage("portfolio-verification");
    const before = attemptTotals(["grok", "cache", "portfolio-web", "twitterapi"]);
    try {
      const result = await collectPortfolioRelationships(ctx);
      const attempts = attemptDelta(before, attemptTotals(["grok", "cache", "portfolio-web", "twitterapi"]));
      const state = result.state === "skipped" ? "unavailable" : result.state === "failed" || result.state === "partial" ? result.state : observedRunState(attempts);
      checkTracker.provider("portfolio-verification", "Source-backed portfolio verification", state, result.detail);
    } catch (error) {
      const detail = `Portfolio verification failed: ${String(error)}`;
      checkTracker.provider("portfolio-verification", "Source-backed portfolio verification", "failed", detail);
      checkTracker.record({
        id: "vc-portfolio-track-record",
        status: "unavailable",
        note: detail,
        provider: "portfolio-web"
      });
      emit({ phase: "Investor", label: "Portfolio verification incomplete", detail, source: "portfolio-web", tone: "warn" });
    } finally {
      finishRuntimeStage("portfolio-verification", portfolioStartedAt);
    }
    const fundScaleStartedAt = startRuntimeStage("fund-scale-verification");
    const fundScaleBefore = attemptTotals(["grok", "cache", "fund-scale-web", "twitterapi"]);
    try {
      const result = await collectFundScale(ctx);
      const attempts = attemptDelta(fundScaleBefore, attemptTotals(["grok", "cache", "fund-scale-web", "twitterapi"]));
      const state = result.state === "skipped" ? "unavailable" : result.state === "failed" || result.state === "partial" ? result.state : observedRunState(attempts);
      checkTracker.provider("fund-scale-verification", "Source-backed fund-scale verification", state, result.detail);
    } catch (error) {
      const detail = `Fund-scale verification failed: ${String(error)}`;
      checkTracker.provider("fund-scale-verification", "Source-backed fund-scale verification", "failed", detail);
      emit({ phase: "Investor", label: "Fund scale incomplete", detail, source: "fund-scale-web", tone: "warn" });
    } finally {
      finishRuntimeStage("fund-scale-verification", fundScaleStartedAt);
    }
  } else {
    checkTracker.provider("portfolio-verification", "Source-backed portfolio verification", "skipped", "not a provider-backed investor/fund role");
    checkTracker.provider("fund-scale-verification", "Source-backed fund-scale verification", "skipped", "not a provider-backed investor/fund role");
  }
  const trustGraphStartedAt = startRuntimeStage("trust-graph");
  try {
    const provisional = assembleDossier(evidence, true);
    const graphResult = await collectTrustGraph(ctx, {
      handle: provisional.handle,
      nodes: provisional.graph.nodes,
      edges: provisional.graph.edges,
      aliases: [provisional.handle]
    });
    checkTracker.provider(
      "trust-graph",
      "Frozen trust-graph reconciliation",
      graphResult.state,
      graphResult.detail
    );
  } catch (error) {
    const detail = `Trust-graph materialization failed: ${String(error)}`;
    checkTracker.provider("trust-graph", "Frozen trust-graph reconciliation", "failed", detail);
    checkTracker.record({
      id: "trust-graph-connections",
      status: "unavailable",
      note: detail,
      provider: "argus-graph"
    });
    emit({ phase: "Network", label: "Trust graph incomplete", detail, source: "argus-graph", tone: "warn" });
  } finally {
    finishRuntimeStage("trust-graph", trustGraphStartedAt);
  }
  const profileForLlm = { ...evidence.profile };
  delete profileForLlm.identity_confidence;
  delete profileForLlm.identity_note;
  const baseEvidence = {
    profile: profileForLlm,
    ventures: evidence.ventures,
    testimonials: evidence.testimonials,
    advised: evidence.advised,
    promotions: evidence.promotions.map((promotion) => ({ ...promotion, provider: "twitterapi" })),
    wallets: evidence.wallets.map((wallet) => ({ ...wallet, provider: "find-wallet/onchain" })),
    clientEngagements: evidence.clientEngagements,
    associates: evidence.associates,
    // The named people behind the project (from the site + LinkedIn + X content),
    // so identity/founder scoring reflects the team we actually found.
    team: (evidence.webTeam ?? []).map((p) => ({
      name: p.name,
      handle: p.identity_link_evidence_origin === "model_lead" ? void 0 : p.handle,
      role: p.role,
      linkedin: p.identity_link_evidence_origin === "model_lead" ? void 0 : p.linkedin,
      source: p.source,
      sourceUrl: p.sourceUrl,
      evidence: p.evidence,
      otherProjects: p.projects_evidence_origin === "model_lead" ? void 0 : p.projects,
      provider: p.provider,
      evidence_origin: p.evidence_origin,
      artifact_verified: p.artifact_verified
    })),
    ventureTeams: evidence.ventureTeams,
    findings: evidence.findings,
    notableFollowers: evidence.notableFollowers.map((follower) => ({ ...follower, provider: "twitterapi" })),
    recentActivity: evidence.recentActivity.slice(0, 12).map((text2) => ({ text: text2, provider: "twitterapi" })),
    sourceArtifacts: evidence.sourceArtifacts,
    profileAuthenticity: evidence.profileAuthenticity,
    trustGraphScreen: evidence.trustGraphScreen,
    projectToken: evidence.projectToken,
    basicFacts: evidence.basicFacts,
    checkOutcomes: checkTracker.snapshot(evidence.roles, { resolvedRealName: hasResolvedRealName(ctx) }),
    providerRuns: checkTracker.providers().runs
  };
  const analystStartedAt = startRuntimeStage("analyst");
  if (analystAvailable()) {
    const requestedAxes = axisCatalog(evidence.roles);
    const evidenceJson = buildScoringEvidencePacket(baseEvidence, requestedAxes);
    const frozenAxisEvidence = extractScoringEvidenceCatalog(evidenceJson, requestedAxes);
    const projectStrengthBands = deriveProjectStrengthBands(evidenceJson, requestedAxes);
    const scoringPreflight = inspectAnalystScoringPreflight(requestedAxes, evidenceJson);
    const decisionPacketUsable = scoringPreflight.state === "ready" || scoringPreflight.state === "insufficient_evidence";
    if (decisionPacketUsable) {
      emit({ phase: "Contradictions", label: "Scan materials", detail: "Cross-referencing every claim against the collected evidence for internal contradictions\u2026", tone: "neutral" });
    }
    if (scoringPreflight.state === "ready") {
      emit({ phase: "Analyst", label: "Score axes", detail: "AI analyst scoring every axis from the collected evidence\u2026", tone: "neutral" });
    }
    if (frozenAxisEvidence.length > 0) {
      evidence.axisCitationVersion = 1;
      evidence.axisEvidenceCatalog = frozenAxisEvidence;
      if (Object.keys(projectStrengthBands).length > 0) {
        evidence.projectStrengthBands = projectStrengthBands;
      }
    }
    evidence.axes = [];
    const contradictionBefore = analystAttemptTotals(["record_contradictions"]);
    const scorerBefore = analystAttemptTotals(["record_verdict"]);
    const analystDeadlineAt = options?.analystDeadlineAt ?? runtimeStartedAt + DEEP_INVESTIGATION_MAX_DURATION_SECONDS * 1e3 - ANALYST_FINALIZATION_RESERVE_MS;
    const [found, verdict] = await Promise.all([
      decisionPacketUsable ? scanContradictions(evidence.profile.handle, evidenceJson, { deadlineAt: analystDeadlineAt }) : Promise.resolve(null),
      scoringPreflight.state === "ready" ? analyzeSubject(evidence.profile.handle, evidence.roles, requestedAxes, evidenceJson, {
        analystDeadlineAt
      }) : Promise.resolve(null)
    ]);
    const contradictionAttempts = attemptDelta(
      contradictionBefore,
      analystAttemptTotals(["record_contradictions"])
    );
    const scorerAttempts = attemptDelta(
      scorerBefore,
      analystAttemptTotals(["record_verdict"])
    );
    const contradictionObserved = contradictionAttempts.total > 0;
    const scorerObserved = scorerAttempts.total > 0;
    if (!decisionPacketUsable) {
      const detail = scoringPreflight.state === "packet_oversize" ? "Contradiction analysis was skipped because the bounded evidence packet could not preserve required coverage." : scoringPreflight.state === "no_axes" ? "Contradiction analysis was skipped because no provider-backed role selected a methodology." : scoringPreflight.state === "unsupported_axes" ? "Contradiction analysis was skipped because the requested methodology contains unsupported axes." : "Contradiction analysis was skipped because the frozen evidence catalog failed validation.";
      emit({ phase: "Contradictions", label: "Skipped", detail, tone: "warn" });
    } else if (contradictionObserved && found && found.length) {
      evidence.contradictions = found;
      const worst = found.some((c) => c.severity === "high") ? "bad" : "warn";
      emit({ phase: "Contradictions", label: `${found.length} contradiction${found.length === 1 ? "" : "s"}`, detail: found.slice(0, 3).map((c) => `${c.claim} vs ${c.conflict}`).join(" \xB7 "), source: "AI analyst", tone: worst });
    } else if (contradictionObserved && found) {
      emit({ phase: "Contradictions", label: "None found", detail: "No internal contradictions surfaced across the subject's claims and the evidence.", source: "AI analyst", tone: "good" });
    } else {
      emit({ phase: "Contradictions", label: "Incomplete", detail: "Contradiction analysis did not return a complete result.", source: "AI analyst", tone: "warn" });
    }
    if (scorerObserved && verdict) {
      evidence.axes = verdict.axes;
      evidence.headline = verdict.headline || evidence.headline;
      if (verdict.identity_note) evidence.profile.identity_note = verdict.identity_note;
      emit({ phase: "Analyst", label: "Scored", detail: `${verdict.axes.length} axes scored.`, source: "AI analyst", tone: "good" });
    } else if (scoringPreflight.state === "packet_oversize") {
      evidence.headline = `Investigation incomplete: the analyst evidence packet could not preserve required coverage within ${ANALYST_EVIDENCE_MAX_CHARS.toLocaleString("en-US")} characters. No axis scores were inferred.`;
      emit({
        phase: "Analyst",
        label: "Packet budget exceeded",
        detail: "Scoring failed closed before any model call; the evidence packet was replaced by an explicit oversize marker instead of dropping required axis coverage.",
        tone: "warn"
      });
    } else if (scoringPreflight.state === "no_axes") {
      evidence.headline = "Investigation incomplete: no provider-backed role selected a scoring methodology. No axis scores were inferred.";
      emit({
        phase: "Analyst",
        label: "No methodology",
        detail: "No scorer call was made because provider-backed role routing produced no methodology axes.",
        tone: "warn"
      });
    } else if (scoringPreflight.state === "unsupported_axes") {
      const unsupportedAxes = scoringPreflight.unsupportedAxes.join(", ");
      evidence.headline = `Investigation incomplete: unsupported methodology axes were requested (${unsupportedAxes}). No axis scores were inferred.`;
      emit({
        phase: "Analyst",
        label: "Unsupported methodology",
        detail: `No scorer call was made because these axes have no deterministic evidence-routing rule: ${unsupportedAxes}.`,
        tone: "warn"
      });
    } else if (scoringPreflight.state === "insufficient_evidence") {
      const missingAxes = scoringPreflight.missingSubstantiveAxes.join(", ");
      evidence.headline = `Investigation incomplete: substantive evidence is missing for ${missingAxes}. No axis scores were inferred.`;
      emit({
        phase: "Analyst",
        label: "Coverage abstention",
        detail: `Scoring did not run because these axes lack substantive eligible evidence: ${missingAxes}. Coverage-only gaps were preserved; no zero scores were inferred.`,
        tone: "warn"
      });
    } else if (scoringPreflight.state === "invalid_catalog") {
      evidence.headline = "Investigation incomplete: the frozen analyst evidence catalog did not pass preflight validation.";
      emit({
        phase: "Analyst",
        label: "Preflight failed",
        detail: "The frozen evidence catalog was invalid, so no scorer call was made and no verdict score will be published.",
        tone: "warn"
      });
    } else if (!scorerObserved) {
      evidence.headline = "Investigation incomplete: the analyst scorer did not run within the available execution budget.";
      emit({
        phase: "Analyst",
        label: "Not run",
        detail: "Evidence preflight passed, but no scorer provider attempt was observed. No verdict score will be published.",
        tone: "warn"
      });
    } else {
      evidence.headline = "Investigation incomplete: the analyst did not return one valid score for every required axis.";
      emit({ phase: "Analyst", label: "Invalid response", detail: "The scorer response was unavailable, partial, duplicated an axis, or contained an invalid score. No verdict score will be published.", tone: "warn" });
    }
    const analystState = scoringPreflight.state === "packet_oversize" || scoringPreflight.state === "unsupported_axes" || scoringPreflight.state === "invalid_catalog" ? "failed" : scoringPreflight.state !== "ready" || !scorerObserved ? "skipped" : verdict ? "executed" : observedRunState(scorerAttempts) === "failed" ? "failed" : "partial";
    const analystDetail = scoringPreflight.state === "packet_oversize" ? `scoring packet exceeded the ${ANALYST_EVIDENCE_MAX_CHARS}-character structural budget while preserving required axis coverage; no scorer call made` : scoringPreflight.state === "no_axes" ? "no provider-backed methodology axes were requested; no scorer call made" : scoringPreflight.state === "unsupported_axes" ? `unsupported methodology axes: ${scoringPreflight.unsupportedAxes.join(", ")}; no scorer call made` : scoringPreflight.state === "insufficient_evidence" ? `coverage preflight abstained; missing substantive evidence for ${scoringPreflight.missingSubstantiveAxes.join(", ")}; no scorer call made` : scoringPreflight.state === "invalid_catalog" ? "scoring preflight rejected the frozen evidence or axis catalog; no scorer call made" : !scorerObserved ? "evidence preflight passed; no scorer provider attempt was observed" : `${scorerAttempts.total} observed scorer attempt${scorerAttempts.total === 1 ? "" : "s"}; ${verdict ? "complete axis set returned" : "axis result incomplete"}`;
    checkTracker.provider(
      "ai-analyst",
      "AI analyst",
      analystState,
      analystDetail
    );
  } else {
    checkTracker.provider("ai-analyst", "AI analyst", "unavailable", "analyst provider is not configured");
  }
  finishRuntimeStage("analyst", analystStartedAt);
  if (!evidence.axes.length) {
    if (!evidence.headline) evidence.headline = "Investigation incomplete: not enough validated evidence to score every required axis.";
    emit({ phase: "Finalize", label: "Incomplete", detail: "Not enough validated evidence to score every required axis; publishing an incomplete report with no verdict score.", tone: "warn" });
  }
  emit({ phase: "Finalize", label: "Govern composite", detail: "Applying caps and selecting the governing role.", tone: "neutral" });
  await delay(300);
  const cost = getCost();
  const dossier = assembleDossier(evidence, cost.calls.some((line) => line.calls > 0));
  const checkScope = { resolvedRealName: hasResolvedRealName(ctx) };
  dossier.checkRuns = checkTracker.snapshot(evidence.roles, checkScope);
  const checkCompleteness = checkTracker.completeness(evidence.roles, checkScope);
  dossier.completeness_state = dossier.report.composite_verdict === "INCOMPLETE" ? "partial" : checkCompleteness;
  dossier.providerSnapshot = checkTracker.providers();
  dossier.cost = cost;
  emit({ phase: "Finalize", label: "Audit cost", detail: `~$${cost.usd.toFixed(2)} this audit (Grok $${cost.grokUsd.toFixed(2)} across ${cost.grokCalls} calls, \u2248${cost.sources} search sources \xB7 Claude $${cost.claudeUsd.toFixed(2)} across ${cost.claudeCalls} calls).`, tone: "neutral" });
  finishRuntimeStage("pipeline", runtimeStartedAt);
  return dossier;
}
function runAudit(rawHandle, emit, options) {
  return withCostLedger(() => runAuditWithLedger(rawHandle, emit, options));
}

// src/token/sources.ts
var GOPLUS_CHAIN = {
  ethereum: "1",
  bsc: "56",
  base: "8453",
  polygon: "137",
  arbitrum: "42161",
  optimism: "10",
  avalanche: "43114",
  fantom: "250",
  cronos: "25",
  zksync: "324",
  linea: "59144",
  scroll: "534352"
};
async function dexByTokenResult(address) {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`, {
      signal: AbortSignal.timeout(8e3)
    });
    if (!res.ok) return { ok: false, pairs: [] };
    const d = await res.json();
    return { ok: true, pairs: d.pairs ?? [] };
  } catch {
    return { ok: false, pairs: [] };
  }
}
async function dexByToken(address) {
  const result = await dexByTokenResult(address);
  return result.pairs;
}
var CG_PLATFORM = {
  ethereum: "ethereum",
  eth: "ethereum",
  base: "base",
  solana: "solana",
  bsc: "binance-smart-chain",
  polygon: "polygon-pos",
  arbitrum: "arbitrum-one",
  optimism: "optimistic-ethereum",
  avalanche: "avalanche",
  fantom: "fantom"
};
var CG_DEX = /uniswap|pancake|raydium|sushi|curve|balancer|orca|meteora|aerodrome|camelot|quickswap|trader.?joe|\bdex\b/i;
function cleanBlurb(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let s = raw.replace(/<[^>]+>/g, " ").replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, "$1").replace(/https?:\/\/\S+/g, "").replace(/[*_`>#]+/g, " ").replace(/&amp;/g, "&").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;
  const sentences = s.match(/[^.!?]+[.!?]+/g);
  if (sentences && sentences.length) s = sentences.slice(0, 2).join(" ").trim();
  if (s.length > 300) s = s.slice(0, 297).replace(/\s+\S*$/, "") + "\u2026";
  return s;
}
var CG_TIER1 = /binance|coinbase|kraken|okx|bybit|kucoin|gate|crypto\.?com|bitget|upbit|huobi|htx|mexc/i;
async function coingeckoToken(chain, address) {
  const plat = CG_PLATFORM[chain] ?? chain;
  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/coins/${plat}/contract/${address}?localization=false&tickers=true&market_data=true&community_data=false&developer_data=false`);
    if (res.status === 404) return { listed: false, rank: null, mcapUsd: null, marketCount: 0, cexCount: 0, cexNames: [], homepage: null, twitter: null, image: null, description: null };
    if (!res.ok) return null;
    const d = await res.json();
    const tickers = d.tickers ?? [];
    const markets = new Set(tickers.map((t) => t.market?.name).filter(Boolean));
    const cex = new Set(tickers.filter((t) => !CG_DEX.test(t.market?.identifier || t.market?.name || "")).map((t) => t.market?.name).filter(Boolean));
    const cexNames = [...cex].sort((a, b) => (CG_TIER1.test(b) ? 1 : 0) - (CG_TIER1.test(a) ? 1 : 0)).slice(0, 12);
    const homepageValue = (d.links?.homepage ?? []).find((value) => typeof value === "string" && /^https?:\/\//i.test(value));
    const homepage = typeof homepageValue === "string" ? homepageValue : null;
    const tw = typeof d.links?.twitter_screen_name === "string" ? d.links.twitter_screen_name.replace(/^@/, "").trim() : "";
    const twitter = /^[A-Za-z0-9_]{2,30}$/.test(tw) ? tw : null;
    const image = d.image?.large ?? d.image?.small ?? d.image?.thumb ?? null;
    return { listed: true, rank: d.market_cap_rank ?? null, mcapUsd: d.market_data?.market_cap?.usd ?? null, marketCount: markets.size, cexCount: cex.size, cexNames, homepage, twitter, image, description: cleanBlurb(d.description?.en) };
  } catch {
    return null;
  }
}
async function dexByPairResult(chain, pair) {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/pairs/${chain}/${pair}`, {
      signal: AbortSignal.timeout(8e3)
    });
    if (!res.ok) return { ok: false, pair: null };
    const d = await res.json();
    return { ok: true, pair: d.pair ?? d.pairs?.[0] ?? null };
  } catch {
    return { ok: false, pair: null };
  }
}
async function dexByPair(chain, pair) {
  const result = await dexByPairResult(chain, pair);
  return result.pair;
}
function pickPair(pairs, wantAddress) {
  if (!pairs.length) return null;
  const byLiq = [...pairs].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  if (wantAddress) {
    const exact = byLiq.find((p) => p.baseToken?.address === wantAddress);
    if (exact) return exact;
    const match = /^0x[0-9a-f]{40}$/i.test(wantAddress) ? byLiq.find((p) => p.baseToken?.address?.toLowerCase() === wantAddress.toLowerCase()) : void 0;
    if (match) return match;
  }
  return byLiq[0];
}
async function honeypotIs(chainId, address) {
  try {
    const res = await fetch(`https://api.honeypot.is/v2/IsHoneypot?address=${address}&chainID=${chainId}`);
    if (!res.ok) return null;
    const d = await res.json();
    return {
      isHoneypot: !!d.honeypotResult?.isHoneypot,
      simSuccess: !!d.simulationSuccess,
      buyTax: d.simulationResult?.buyTax ?? 0,
      sellTax: d.simulationResult?.sellTax ?? 0,
      flags: (d.flags ?? []).map((flag) => typeof flag === "string" ? flag : flag.description ?? flag.flag ?? String(flag))
    };
  } catch {
    return null;
  }
}
async function goplusSolana(mint) {
  try {
    const res = await fetch(`https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${mint}`);
    if (!res.ok) return null;
    const d = await res.json();
    const row = d.result?.[mint] ?? (d.result ? Object.values(d.result)[0] : void 0);
    return row ?? null;
  } catch {
    return null;
  }
}
async function goplus(chainId, address) {
  const once = async () => {
    try {
      const res = await fetch(`https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${address}`);
      if (!res.ok) return null;
      const d = await res.json();
      return d.result?.[address.toLowerCase()] ?? (d.result ? Object.values(d.result)[0] : void 0) ?? null;
    } catch {
      return null;
    }
  };
  let row = await once();
  if (row && !(row.holders && row.holders.length)) {
    await new Promise((r) => setTimeout(r, 700));
    const retry = await once();
    if (retry?.holders?.length) row = retry;
  }
  return row;
}

// src/token/audit.ts
var clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
var num2 = (s) => s == null || s === "" ? null : Number(s);
var t1 = (s) => s === "1";
var solFlag = (x) => x?.status === "1";
function band(score) {
  return score >= 70 ? "PASS" : score >= 40 ? "CAUTION" : "FAIL";
}
function handleFromUrl(url) {
  if (!url) return null;
  const m = url.match(/(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{2,30})/i);
  return m ? "@" + m[1].toLowerCase() : null;
}
var isBurnAddr = (a) => !!a && (/^0x0+$/.test(a) || /0*dead$/i.test(a.replace(/^0x/, "")));
var isBurnTag = (t) => /null|burn|dead|0x0{4,}/i.test(t ?? "");
function evmSafety(gp, sim) {
  const s = sim;
  const topHolderPct = gp?.holders?.length ? Number(gp.holders[0].percent) * 100 : null;
  let lpBurnedPct = 0, lpLockedPct = 0, lpTopUnlockedEoaPct = 0;
  for (const h of gp?.lp_holders ?? []) {
    const pct = Number(h.percent) * 100;
    if (!Number.isFinite(pct)) continue;
    if (isBurnAddr(h.address) || isBurnTag(h.tag)) lpBurnedPct += pct;
    else if (h.is_locked === 1) lpLockedPct += pct;
    else if (h.is_contract !== 1) lpTopUnlockedEoaPct = Math.max(lpTopUnlockedEoaPct, pct);
  }
  const lpLocked = lpBurnedPct + lpLockedPct >= 50;
  return {
    available: !!gp || !!s,
    simChecked: !!s,
    honeypot: t1(gp?.is_honeypot) || (s?.isHoneypot ?? false),
    honeypotOnchain: t1(gp?.is_honeypot) || t1(gp?.cannot_sell_all),
    serialScammerCreator: t1(gp?.honeypot_with_same_creator),
    mintable: t1(gp?.is_mintable),
    freezable: false,
    nonTransferable: false,
    ownerRenounced: !gp?.owner_address || /^0x0+$/.test(gp.owner_address || "") || gp.owner_address === "",
    takeBack: t1(gp?.can_take_back_ownership),
    hiddenOwner: t1(gp?.hidden_owner),
    selfdestruct: t1(gp?.selfdestruct),
    pausable: t1(gp?.transfer_pausable),
    openSource: t1(gp?.is_open_source),
    cannotSellAll: t1(gp?.cannot_sell_all),
    metadataMutable: false,
    buyTax: s?.simSuccess ? s.buyTax : (num2(gp?.buy_tax) ?? 0) * 100,
    sellTax: s?.simSuccess ? s.sellTax : (num2(gp?.sell_tax) ?? 0) * 100,
    holderCount: num2(gp?.holder_count) ?? 0,
    topHolderPct,
    lpLocked,
    lpBurnedPct,
    lpLockedPct,
    lpTopUnlockedEoaPct,
    balanceMutable: false,
    transferHook: false,
    transferFee: false,
    proxy: t1(gp?.is_proxy),
    slippageModifiable: t1(gp?.slippage_modifiable) || t1(gp?.personal_slippage_modifiable),
    blacklist: t1(gp?.is_blacklisted),
    tradingCooldown: t1(gp?.trading_cooldown),
    externalCall: t1(gp?.external_call),
    ownerChangeBalance: t1(gp?.owner_change_balance),
    creatorPercent: (num2(gp?.creator_percent) ?? 0) * 100
  };
}
function solanaSafety(sol) {
  const topHolderPct = sol?.holders?.length ? Number(sol.holders[0].percent) * 100 : null;
  let lpLockedPct = 0, lpTopUnlockedEoaPct = 0;
  for (const h of sol?.lp_holders ?? []) {
    const pct = Number(h.percent) * 100;
    if (!Number.isFinite(pct)) continue;
    if (h.is_locked === 1) lpLockedPct += pct;
    else lpTopUnlockedEoaPct = Math.max(lpTopUnlockedEoaPct, pct);
  }
  const lpLocked = lpLockedPct >= 50;
  const mintable = solFlag(sol?.mintable);
  const freezable = solFlag(sol?.freezable);
  return {
    available: !!sol,
    simChecked: false,
    honeypot: !!sol?.non_transferable && sol.non_transferable === "1",
    honeypotOnchain: sol?.non_transferable === "1",
    serialScammerCreator: false,
    // GoPlus's same-creator honeypot flag is EVM-only
    mintable,
    freezable,
    nonTransferable: sol?.non_transferable === "1",
    ownerRenounced: !mintable && !freezable,
    // both authorities revoked
    takeBack: false,
    hiddenOwner: false,
    selfdestruct: solFlag(sol?.closable),
    pausable: false,
    openSource: true,
    // n/a on Solana SPL; not penalised
    cannotSellAll: false,
    metadataMutable: solFlag(sol?.metadata_mutable),
    buyTax: 0,
    sellTax: 0,
    holderCount: num2(sol?.holder_count) ?? 0,
    topHolderPct,
    lpLocked,
    lpBurnedPct: 0,
    lpLockedPct,
    lpTopUnlockedEoaPct,
    balanceMutable: solFlag(sol?.balance_mutable_authority),
    transferHook: (sol?.transfer_hook?.length ?? 0) > 0,
    transferFee: Object.keys(sol?.transfer_fee ?? {}).length > 0,
    proxy: false,
    slippageModifiable: false,
    blacklist: false,
    tradingCooldown: false,
    externalCall: false,
    ownerChangeBalance: false,
    creatorPercent: 0
  };
}
function emptySafety() {
  return {
    available: false,
    simChecked: false,
    honeypot: false,
    honeypotOnchain: false,
    serialScammerCreator: false,
    mintable: false,
    freezable: false,
    nonTransferable: false,
    ownerRenounced: false,
    takeBack: false,
    hiddenOwner: false,
    selfdestruct: false,
    pausable: false,
    openSource: false,
    cannotSellAll: false,
    metadataMutable: false,
    buyTax: 0,
    sellTax: 0,
    holderCount: 0,
    topHolderPct: null,
    lpLocked: false,
    lpBurnedPct: 0,
    lpLockedPct: 0,
    lpTopUnlockedEoaPct: 0,
    balanceMutable: false,
    transferHook: false,
    transferFee: false,
    proxy: false,
    slippageModifiable: false,
    blacklist: false,
    tradingCooldown: false,
    externalCall: false,
    ownerChangeBalance: false,
    creatorPercent: 0
  };
}
var _cache = /* @__PURE__ */ new Map();
var CACHE_TTL = 6e4;
async function auditToken(input, emit, opts) {
  if (input.kind !== "token") return null;
  const cacheRef = input.via === "evm" ? input.ref.toLowerCase() : input.ref;
  const key = `${input.via}:${cacheRef}:${opts?.skipSim ? 1 : 0}`;
  const hit = opts?.force ? void 0 : _cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.d;
  const d = await runTokenAudit(input, emit, opts);
  _cache.set(key, { at: Date.now(), d });
  return d;
}
async function runTokenAudit(input, emit, opts) {
  if (input.kind !== "token") return null;
  const trace = [];
  const step = (s2) => {
    trace.push(s2);
    emit?.(s2);
  };
  step({ phase: "P0 \xB7 Intake", label: "Resolve token", detail: `Resolving ${input.ref.slice(0, 42)} on DexScreener\u2026`, tone: "neutral" });
  let pair = null;
  if (input.via === "dexscreener") {
    const m = input.ref.match(/dexscreener\.com\/([a-z0-9]+)\/([a-zA-Z0-9]+)/i);
    if (m) pair = await dexByPair(m[1], m[2]);
    if (!pair && m) pair = pickPair(await dexByToken(m[2]), m[2]);
  } else {
    pair = pickPair(await dexByToken(input.ref), input.ref);
  }
  if (!pair || !pair.baseToken) {
    step({ phase: "P0 \xB7 Intake", label: "Not found", detail: "No DEX pair found for this contract.", tone: "warn" });
    return null;
  }
  const address = pair.baseToken.address;
  const chain = pair.chainId;
  const liquidityUsd = pair.liquidity?.usd ?? 0;
  const fdv = pair.marketCap ?? pair.fdv ?? 0;
  const vol24 = pair.volume?.h24 ?? 0;
  const buys = pair.txns?.h24?.buys ?? 0;
  const sells = pair.txns?.h24?.sells ?? 0;
  const pc24 = pair.priceChange?.h24 ?? 0;
  const ageDays = pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / 864e5 : void 0;
  const volLiq = liquidityUsd > 0 ? vol24 / liquidityUsd : 0;
  const washSignature = volLiq >= 15 && Math.abs(pc24) < 10 && buys + sells >= 50;
  step({ phase: "Market", label: `$${pair.baseToken.symbol}`, detail: `liquidity $${Math.round(liquidityUsd).toLocaleString()}, 24h vol $${Math.round(vol24).toLocaleString()}, mcap $${Math.round(fdv).toLocaleString()}`, source: "dexscreener", tone: liquidityUsd < 15e3 ? "warn" : "neutral" });
  const gpChain = GOPLUS_CHAIN[chain];
  let safety = emptySafety();
  let gpEvm = null;
  let sol = null;
  if (chain === "solana") {
    step({ phase: "Contract", label: "Solana safety", detail: "GoPlus Solana: mint authority, freeze authority, transfer hooks, holders\u2026", tone: "neutral" });
    sol = await goplusSolana(address);
    safety = solanaSafety(sol);
  } else if (gpChain) {
    step({ phase: "Contract", label: opts?.skipSim ? "Safety scan" : "Safety + simulation", detail: opts?.skipSim ? "GoPlus: honeypot, mint, ownership, tax, holders\u2026" : "GoPlus + honeypot.is buy/sell simulation\u2026", tone: "neutral" });
    const [gp, sim] = await Promise.all([goplus(gpChain, address), opts?.skipSim ? Promise.resolve(null) : honeypotIs(gpChain, address)]);
    gpEvm = gp;
    safety = evmSafety(gp, sim);
  } else {
    step({ phase: "Contract", label: "Limited", detail: `On-chain safety not available for ${chain} keyless; scored on market data only.`, tone: "warn" });
  }
  const findings = [];
  const caps = [];
  const s = safety;
  let cg = null;
  if (!opts?.skipSim) {
    step({ phase: "Corroborate", label: "CoinGecko cross-check", detail: "Independent listing, CEX markets, market-cap vs FDV\u2026", tone: "neutral" });
    cg = await coingeckoToken(chain, address);
  }
  const provablySellable = sells >= 10 && liquidityUsd >= 25e4;
  const broadlyTraded = (cg?.cexCount ?? 0) >= 5 || provablySellable;
  if (s.available) {
    if (s.honeypot) {
      const simOnly = !s.honeypotOnchain && !s.cannotSellAll;
      if (simOnly && broadlyTraded) {
        const why = (cg?.cexCount ?? 0) >= 5 ? `${cg.cexCount} centralized markets` : `${sells} on-chain sells against $${Math.round(liquidityUsd).toLocaleString()} liquidity in 24h`;
        findings.push({ claim: `honeypot.is reported a failed sell simulation, but the GoPlus on-chain check and ${why} contradict it. ARGUS treats this as a simulation artifact, not a honeypot.`, tone: "warn", source: "argus" });
      } else {
        caps.push([10, "honeypot_confirmed"]);
        findings.push({ claim: s.nonTransferable ? "Non-transferable token: holders cannot move it." : "Honeypot: the contract blocks selling.", tone: "bad", source: s.honeypotOnchain ? "goplus" : "sim" });
      }
    }
    if (s.cannotSellAll) caps.push([15, "cannot_sell_all"]);
    const cexN = cg?.cexCount ?? 0;
    const mcap = fdv;
    const established = cexN >= 5 || cexN >= 3 && mcap >= 1e7 || cexN >= 1 && mcap >= 1e8;
    const authorityTone = established ? "warn" : "bad";
    const govNote = established ? " On a token with real centralized-exchange listings this is typically a governed emissions/ops mechanism, not a rug setup. Confirm the controller." : "";
    if (s.mintable) {
      if (!established) caps.push([35, "mint_authority_active"]);
      findings.push({ claim: `Mint authority is live: supply can be minted.${govNote}`, tone: authorityTone, source: chain === "solana" ? "goplus-sol" : "goplus" });
    }
    if (s.freezable) {
      if (!established) caps.push([35, "freeze_authority_active"]);
      findings.push({ claim: `Freeze authority is live: the team can freeze token accounts.${govNote}`, tone: authorityTone, source: "goplus-sol" });
    }
    if (s.takeBack || s.hiddenOwner) {
      if (s.hiddenOwner) {
        caps.push([35, "reclaimable_ownership"]);
        findings.push({ claim: "Hidden owner detected.", tone: "bad", source: "goplus" });
      } else {
        if (!established) caps.push([35, "reclaimable_ownership"]);
        findings.push({ claim: `Ownership can be reclaimed after renouncement.${govNote}`, tone: authorityTone, source: "goplus" });
      }
    }
    if (s.selfdestruct) findings.push({ claim: "Contract can self-destruct / be closed.", tone: "bad", source: "goplus" });
    if (s.serialScammerCreator) {
      caps.push([25, "serial_scammer_creator"]);
      findings.push({ claim: "The wallet that deployed this token has created honeypot tokens before. This is a serial-scammer signal.", tone: "bad", source: "goplus" });
    }
    if (s.sellTax >= 20) findings.push({ claim: `Sell tax is ${s.sellTax.toFixed(0)}%.`, tone: "bad", source: s.simChecked ? "sim" : "goplus" });
    if (s.simChecked && !s.honeypot) findings.push({ claim: `Sell simulation passed (buy ${s.buyTax.toFixed(0)}% / sell ${s.sellTax.toFixed(0)}%).`, tone: "good", source: "honeypot.is" });
    if (s.ownerRenounced && !s.mintable && !s.takeBack && !s.freezable) findings.push({ claim: chain === "solana" ? "Mint and freeze authority revoked." : "Ownership renounced; no mint or take-back.", tone: "good", source: "goplus" });
    const ownerActive = !s.ownerRenounced;
    if (s.ownerChangeBalance && ownerActive) {
      if (broadlyTraded) {
        findings.push({ claim: "GoPlus flags an owner-modify-balance capability, but broad CEX listing and deep liquidity indicate it is a governance/upgrade artifact, not an active threat.", tone: "warn", source: "argus" });
      } else {
        caps.push([20, "owner_can_modify_balance"]);
        findings.push({ claim: "Owner can modify holder balances directly; they can zero your wallet.", tone: "bad", source: "goplus" });
      }
    }
    if (s.proxy) findings.push({ claim: ownerActive ? "Upgradeable proxy with an active owner: the contract logic can be swapped out from under holders." : "Upgradeable proxy contract (logic is replaceable), though ownership is renounced.", tone: ownerActive ? "bad" : "warn", source: "goplus" });
    if (s.slippageModifiable && ownerActive) findings.push({ claim: "Tax is modifiable: a low tax now can be raised toward 100% after you buy.", tone: "bad", source: "goplus" });
    if (s.blacklist && ownerActive) findings.push({ claim: "Owner can blacklist addresses, so your wallet can be blocked from selling.", tone: "warn", source: "goplus" });
    if (s.tradingCooldown && ownerActive) findings.push({ claim: "Trading cooldown is enforceable, so sells can be delayed.", tone: "warn", source: "goplus" });
    if (s.externalCall) findings.push({ claim: "Contract makes external calls, so behavior can change via an external dependency.", tone: "warn", source: "goplus" });
    if (s.creatorPercent >= 5) findings.push({ claim: `Creator still holds ~${s.creatorPercent.toFixed(0)}% of supply.`, tone: s.creatorPercent >= 15 ? "bad" : "warn", source: "goplus" });
    if (chain === "solana") {
      if (s.balanceMutable) {
        if (broadlyTraded) findings.push({ claim: "A balance-mutable authority exists, but broad market presence indicates it is not an active threat.", tone: "warn", source: "argus" });
        else {
          caps.push([20, "balance_mutable_authority"]);
          findings.push({ claim: "Balance-mutable authority is active. The controller can rewrite your token balance.", tone: "bad", source: "goplus-sol" });
        }
      }
      if (s.transferHook) findings.push({ claim: "Transfer hook active: an external program runs on every transfer and can block sells.", tone: "bad", source: "goplus-sol" });
      if (s.transferFee) findings.push({ claim: "A Token-2022 transfer fee is configured: a built-in tax on every transfer.", tone: "warn", source: "goplus-sol" });
    }
    if (s.lpBurnedPct >= 50) findings.push({ claim: `Liquidity is burned (~${s.lpBurnedPct.toFixed(0)}%) and permanently removed; it cannot be pulled.`, tone: "good", source: "goplus" });
    else if (s.lpLockedPct >= 50) findings.push({ claim: `Liquidity is locked (~${s.lpLockedPct.toFixed(0)}%).`, tone: "good", source: "goplus" });
    else if (s.lpTopUnlockedEoaPct >= 80) findings.push({ claim: `All liquidity (~${s.lpTopUnlockedEoaPct.toFixed(0)}%) sits in a single unlocked wallet and can be pulled at any time.`, tone: "bad", source: "goplus" });
    else if (s.lpTopUnlockedEoaPct >= 50) findings.push({ claim: `Most liquidity (~${s.lpTopUnlockedEoaPct.toFixed(0)}%) is in one unlocked wallet and removable at will.`, tone: "warn", source: "goplus" });
    else findings.push({ claim: "Liquidity does not appear locked or burned.", tone: "warn", source: "goplus" });
  }
  if (liquidityUsd < 15e3) findings.push({ claim: `Thin liquidity ($${Math.round(liquidityUsd).toLocaleString()}). Easy to drain or move.`, tone: "warn", source: "dexscreener" });
  if (ageDays != null && ageDays < 7) findings.push({ claim: `Pair is ${ageDays < 1 ? "under a day" : Math.round(ageDays) + " days"} old.`, tone: "warn", source: "dexscreener" });
  if (washSignature) findings.push({ claim: `Volume is ${volLiq.toFixed(0)}x liquidity in 24h while the price moved only ${pc24.toFixed(1)}%: a wash-trading or fake-volume signature.`, tone: "bad", source: "dexscreener" });
  if (pc24 <= -60) findings.push({ claim: `Down ${Math.abs(pc24).toFixed(0)}% in 24h. The token appears to have already dumped.`, tone: "bad", source: "dexscreener" });
  else if (pc24 >= 300 && liquidityUsd < 1e5) findings.push({ claim: `Up ${pc24.toFixed(0)}% in 24h on thin liquidity. This is a vertical pump with high reversal risk.`, tone: "warn", source: "dexscreener" });
  if (!opts?.skipSim) {
    if (cg && !cg.listed) {
      findings.push({ claim: "Not listed on CoinGecko. No independent market-data corroboration is available.", tone: "warn", source: "coingecko" });
    } else if (cg) {
      findings.push({ claim: `Corroborated on CoinGecko${cg.rank ? ` (rank #${cg.rank})` : ""}, ${cg.cexCount} centralized market${cg.cexCount === 1 ? "" : "s"}.`, tone: "good", source: "coingecko" });
      if (cg.mcapUsd && fdv && fdv > cg.mcapUsd * 3) {
        findings.push({ claim: `FDV is ${(fdv / cg.mcapUsd).toFixed(1)}x circulating market cap, creating a large unlock or dilution overhang.`, tone: "warn", source: "coingecko" });
      }
    }
  }
  const rawHolders = chain === "solana" ? sol?.holders ?? [] : gpEvm?.holders ?? [];
  const eoaHolders = rawHolders.filter(
    (h) => !(h.is_contract === 1 || h.is_contract === "1") && h.is_locked !== 1 && !/lock|burn|null|dead|pool|\blp\b|amm|cex|exchange/i.test(h.tag || "")
  );
  const topSum = eoaHolders.slice(0, 15).reduce((a, h) => a + Number(h.percent) * 100, 0);
  const holdersReliable = rawHolders.length > 0 && topSum <= 101;
  const insiderPct = holdersReliable ? Math.round(topSum) : 0;
  const bundleCount = holdersReliable ? eoaHolders.filter((h) => Number(h.percent) * 100 >= 1).length : 0;
  const bundleRisk = !holdersReliable ? "low" : insiderPct >= 45 ? "high" : insiderPct >= 25 ? "elevated" : "low";
  if (s.available && bundleRisk !== "low") {
    findings.push({
      claim: `Concentrated supply: ${bundleCount} non-contract wallets hold ~${insiderPct}%. This may indicate a bundled launch or coordinated snipe.`,
      tone: bundleRisk === "high" ? "bad" : "warn",
      source: chain === "solana" ? "goplus-sol" : "goplus"
    });
  }
  const axes = [];
  let aT1 = liquidityUsd < 2e3 ? 2 : liquidityUsd < 1e4 ? 6 : liquidityUsd < 5e4 ? 12 : liquidityUsd < 25e4 ? 18 : 22;
  let lpNote = "";
  if (s.lpBurnedPct >= 50) {
    aT1 = clamp(aT1 + 3, 0, 24);
    lpNote = ", LP burned";
  } else if (s.lpLockedPct >= 50) {
    aT1 = clamp(aT1 + 2, 0, 24);
    lpNote = ", LP locked";
  } else if (s.available && s.lpTopUnlockedEoaPct >= 80) {
    aT1 = clamp(aT1 - 6, 0, 24);
    lpNote = ", LP in one unlocked wallet";
  } else if (s.available && s.lpTopUnlockedEoaPct >= 50) {
    aT1 = clamp(aT1 - 4, 0, 24);
    lpNote = ", LP mostly in one wallet";
  } else if (s.available) {
    aT1 = clamp(aT1 - 3, 0, 24);
    lpNote = ", LP not locked";
  }
  axes.push({ key: "T1", label: "Liquidity & lock", score: aT1, weight: 24, rationale: `$${Math.round(liquidityUsd).toLocaleString()} pooled${lpNote}.` });
  let aT2 = 26;
  if (!s.available) aT2 = 9;
  else if (chain === "solana") {
    if (s.metadataMutable) aT2 -= 8;
    if (!s.ownerRenounced) aT2 -= 6;
    if (s.transferHook) aT2 -= 8;
  } else {
    if (!s.openSource) aT2 -= 8;
    if (s.pausable) aT2 -= 8;
    if (s.selfdestruct) aT2 -= 10;
    if (!s.ownerRenounced) aT2 -= 4;
    if (s.proxy) aT2 -= s.ownerRenounced ? 3 : 6;
    if (s.externalCall) aT2 -= 3;
    if (!s.ownerRenounced && (s.blacklist || s.tradingCooldown)) aT2 -= 3;
  }
  aT2 = clamp(aT2, 0, 26);
  axes.push({ key: "T2", label: "Contract safety", score: aT2, weight: 26, rationale: s.available ? chain === "solana" ? `${s.ownerRenounced ? "authorities revoked" : "mint/freeze authority active"}${s.metadataMutable ? ", metadata mutable" : ""}.` : `${s.openSource ? "verified" : "unverified"} source, ${s.ownerRenounced ? "ownership renounced" : "owner active"}${s.pausable ? ", pausable" : ""}.` : "On-chain safety not verifiable keyless on this chain." });
  const tax = s.buyTax + s.sellTax;
  let aT3 = !s.available ? 6 : tax === 0 ? 12 : tax <= 10 ? 10 : tax <= 20 ? 7 : tax <= 40 ? 3 : 0;
  if (s.cannotSellAll || s.nonTransferable) aT3 = 0;
  if (s.slippageModifiable && !s.ownerRenounced) aT3 = clamp(aT3 - 5, 0, 12);
  if (s.transferFee) aT3 = clamp(aT3 - 5, 0, 12);
  axes.push({ key: "T3", label: "Taxes & tradeability", score: aT3, weight: 12, rationale: s.available ? chain === "solana" ? "no transfer tax detected." : `buy ${s.buyTax.toFixed(0)}% / sell ${s.sellTax.toFixed(0)}%${s.simChecked ? " (simulated)" : ""}.` : "Tax not verifiable keyless." });
  const topPct = holdersReliable ? s.topHolderPct : null;
  let aT4 = s.holderCount < 50 ? 3 : s.holderCount < 500 ? 7 : s.holderCount < 5e3 ? 11 : 14;
  if (topPct != null) {
    if (topPct > 50) aT4 -= 8;
    else if (topPct > 25) aT4 -= 4;
    else if (topPct > 10) aT4 -= 2;
    else aT4 += 2;
  }
  if (bundleRisk === "high") aT4 = clamp(aT4 - 8, 0, 16);
  else if (bundleRisk === "elevated") aT4 = clamp(aT4 - 4, 0, 16);
  if (s.creatorPercent >= 15) aT4 = clamp(aT4 - 5, 0, 16);
  else if (s.creatorPercent >= 5) aT4 = clamp(aT4 - 2, 0, 16);
  aT4 = clamp(aT4, 0, 16);
  const t4Note = !s.available ? "Holder data not verifiable keyless." : !holdersReliable ? `${s.holderCount.toLocaleString()} holders; distribution not reliably reported by the free data tier.` : `${s.holderCount.toLocaleString()} holders${topPct != null ? `, top holder ${topPct.toFixed(0)}%` : ""}${bundleRisk !== "low" ? `, ~${insiderPct}% in ${bundleCount} fresh wallets` : ""}.`;
  axes.push({ key: "T4", label: "Holder distribution", score: aT4, weight: 16, rationale: t4Note });
  let aT5 = vol24 < 500 ? 4 : volLiq > 25 ? 4 : volLiq > 8 ? 7 : volLiq < 0.02 ? 5 : 11;
  const total = buys + sells;
  if (washSignature) aT5 = 2;
  else if (total > 20 && sells / total > 0.8) aT5 = clamp(aT5 - 2, 0, 12);
  if (pc24 <= -60) aT5 = clamp(aT5 - 3, 0, 12);
  axes.push({ key: "T5", label: "Trading authenticity", score: aT5, weight: 12, rationale: washSignature ? `vol/liquidity ${volLiq.toFixed(1)}x but price flat (${pc24.toFixed(1)}%): wash-trade signature.` : `24h vol/liquidity ${volLiq.toFixed(2)}x, ${buys} buys / ${sells} sells.` });
  const socials = [
    ...(pair.info?.websites ?? []).map((w) => ({ label: "site", url: w.url })),
    ...(pair.info?.socials ?? []).map((x) => ({ label: x.type, url: x.url }))
  ];
  const hasWebsite = socials.some((x) => /^https?:\/\//i.test(x.url) && !/x\.com|twitter\.com|t\.me|discord|github/i.test(x.url));
  const hasTwitter = socials.some((x) => /x\.com|twitter/i.test(x.url) || /twitter|^x$/i.test(x.label));
  if (cg?.homepage && !hasWebsite) socials.push({ label: "site", url: cg.homepage });
  if (cg?.twitter && !hasTwitter) socials.push({ label: "twitter", url: `https://x.com/${cg.twitter}` });
  let aT6 = ageDays == null ? 4 : ageDays < 1 ? 2 : ageDays < 7 ? 4 : ageDays < 30 ? 6 : ageDays < 180 ? 8 : 10;
  if (socials.length) aT6 = clamp(aT6 + 1, 0, 10);
  if (cg?.cexCount) aT6 = clamp(aT6 + 2, 0, 10);
  axes.push({ key: "T6", label: "Maturity & presence", score: aT6, weight: 10, rationale: `${ageDays != null ? (ageDays < 1 ? "<1 day" : Math.round(ageDays) + " days") + " old" : "age unknown"}${socials.length ? `, ${socials.length} socials` : ", no socials"}${cg?.cexCount ? `, ${cg.cexCount} CEX listings` : cg && !cg.listed ? ", not on CoinGecko" : ""}.` });
  const raw = Math.round(axes.reduce((a, x) => a + x.score, 0));
  let capApplied = null;
  let score = raw;
  let verdict;
  if (caps.length) {
    const [ceiling, key] = caps.reduce((m, c) => c[0] < m[0] ? c : m);
    score = Math.min(raw, ceiling);
    capApplied = key;
    verdict = ceiling <= 10 ? "AVOID" : band(score);
  } else verdict = band(score);
  const projectX = handleFromUrl((pair.info?.socials ?? []).find((x) => /twitter|x/i.test(x.type))?.url) || handleFromUrl((pair.info?.websites ?? []).map((w) => w.url).find((u) => /x\.com|twitter\.com/i.test(u))) || (cg?.twitter ? "@" + cg.twitter : null);
  const deployer = chain === "solana" ? sol?.creators?.[0]?.address ?? null : gpEvm?.creator_address || (gpEvm?.owner_address && !/^0x0+$/.test(gpEvm.owner_address) ? gpEvm.owner_address : null) || null;
  const topHolders = rawHolders.slice(0, 10).map((h) => ({
    address: h.address ?? h.account ?? "",
    percent: Number(h.percent) * 100,
    tag: h.tag || void 0,
    isContract: h.is_contract === 1 || h.is_contract === "1"
  })).filter((h) => h.address);
  const graph = buildGraph(chain, address, pair.baseToken.symbol, verdict, projectX, deployer, topHolders, socials);
  const headline = buildHeadline(verdict, capApplied, s, liquidityUsd, projectX);
  step({ phase: "Finalize", label: "Verdict", detail: `${verdict} \xB7 ${score}/100${capApplied ? ` (cap: ${capApplied})` : ""}`, tone: verdict === "PASS" ? "good" : verdict === "CAUTION" ? "warn" : "bad" });
  return {
    address,
    chain,
    dexId: pair.dexId,
    pairAddress: pair.pairAddress,
    symbol: pair.baseToken.symbol,
    name: pair.baseToken.name,
    imageUrl: pair.info?.imageUrl ?? cg?.image ?? void 0,
    priceUsd: pair.priceUsd ? Number(pair.priceUsd) : void 0,
    mcap: fdv,
    liquidityUsd,
    vol24,
    ageDays,
    priceChange: pair.priceChange,
    verdict,
    score,
    capApplied,
    headline,
    axes,
    safety: s,
    socials,
    projectX,
    deployer,
    topHolders,
    insiderPct,
    bundleCount,
    bundleRisk,
    cg,
    graph,
    findings,
    trace,
    live: true,
    safetyChecked: s.available
  };
}
function buildGraph(chain, address, symbol, verdict, projectX, deployer, holders, socials) {
  const center = tokenEntityKey(chain, address);
  const nodes = [{
    type: "Token",
    key: center,
    label: "$" + symbol,
    symbol,
    chain,
    address,
    subject: true,
    was_rug: verdict === "AVOID"
  }];
  const edges = [];
  if (projectX) {
    nodes.push({ type: "Person", key: projectX });
    edges.push({ src: center, dst: projectX, type: "TEAM" });
  }
  if (deployer) {
    const k = walletEntityKey(chain, deployer);
    nodes.push({ type: "Identity", subtype: "Wallet", key: k, label: "wallet:" + deployer.slice(0, 8), chain, address: deployer });
    edges.push({ src: center, dst: k, type: "DEPLOYED_BY" });
  }
  holders.slice(0, 4).forEach((h) => {
    const k = walletEntityKey(chain, h.address);
    nodes.push({ type: "Identity", subtype: "Wallet", key: k, label: (h.tag || "holder") + ":" + h.address.slice(0, 8), chain, address: h.address, concentration: h.percent });
    edges.push({ src: center, dst: k, type: "HELD_BY", verdict: h.percent > 25 ? "Contradicted" : void 0 });
  });
  socials.slice(0, 3).forEach((x) => {
    const xh = x.url.match(/(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{2,30})/i)?.[1];
    const key = xh ? "@" + xh : x.url.match(/^https?:\/\/(?:www\.)?([^/]+)/i)?.[1];
    if (!key || projectX && key.toLowerCase() === projectX.toLowerCase()) return;
    nodes.push({ type: "Company", key });
    edges.push({ src: center, dst: key, type: "LINKS" });
  });
  return { nodes, edges };
}
function buildHeadline(verdict, cap, s, liq, projectX) {
  if (s.honeypot) return s.nonTransferable ? "Non-transferable: holders are locked in. Do not touch." : "Honeypot: buyers cannot sell. Do not touch.";
  if (cap === "mint_authority_active") return "Mint authority is live, the team can dilute holders to zero.";
  if (cap === "freeze_authority_active") return "Freeze authority is live, the team can freeze your tokens at any time.";
  if (cap === "reclaimable_ownership") return "Ownership can be reclaimed after renouncement, a classic rug setup.";
  if (cap === "owner_can_modify_balance") return "Owner can rewrite holder balances, they can zero your wallet at will.";
  if (cap === "balance_mutable_authority") return "A balance-mutable authority can rewrite your token balance at will.";
  if (verdict === "PASS") return `Clears the forensic bar: ${s.ownerRenounced ? "authorities revoked" : "owned"}, ${s.lpLocked ? "LP locked" : "tradeable"}, with real depth${projectX ? `. Team: ${projectX}` : "."}`;
  if (verdict === "CAUTION") return `Tradeable but with reservations${liq < 15e3 ? "; liquidity is thin" : ""}. Size accordingly.`;
  if (!s.available) return "Scored on market data only; on-chain contract safety could not be verified keyless on this chain.";
  return "Falls short on the forensic checks. Treat as high risk.";
}

// src/lib/resolveInput.ts
var EVM = /^0x[a-fA-F0-9]{40}$/;
var SOLANA = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
var TOKEN_CANDIDATE = /^[A-Za-z0-9]{32,44}$/;
var TICKER = /^\$[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/;
var HTTP_URL = /^https?:\/\//i;
var DOMAIN = /^([a-z0-9-]+\.)+[a-z]{2,24}(\/\S*)?$/i;
var NAME_SERVICE = /\.(eth|sol|crypto|nft|bnb|x|lens)$/i;
var approvedHost = (hostname2, root) => hostname2 === root || hostname2.endsWith(`.${root}`);
function inputUrl(value) {
  const candidate = HTTP_URL.test(value) ? value : /^(?:[a-z0-9-]+\.)*(?:x\.com|twitter\.com|dexscreener\.com)\//i.test(value) ? `https://${value}` : null;
  if (!candidate) return null;
  try {
    return new URL(candidate);
  } catch {
    return null;
  }
}
function resolveInput(raw) {
  const s = raw.trim();
  const parsedUrl = inputUrl(s);
  const hostname2 = parsedUrl?.hostname.toLowerCase() ?? "";
  const isDexUrl = !!parsedUrl && approvedHost(hostname2, "dexscreener.com");
  const isXUrl = !!parsedUrl && (approvedHost(hostname2, "x.com") || approvedHost(hostname2, "twitter.com"));
  const dexPath = isDexUrl ? parsedUrl.pathname.match(/^\/([a-z0-9]+)\/([a-zA-Z0-9]+)(?:\/|$)/i) : null;
  if (dexPath && parsedUrl) return { kind: "token", ref: parsedUrl.href, via: "dexscreener" };
  if (TICKER.test(s)) return { kind: "token", ref: s, via: "ticker" };
  if (s.startsWith("$")) return { kind: "token", ref: s, via: "address-candidate" };
  if (EVM.test(s)) return { kind: "token", ref: s, via: "evm" };
  if (!s.startsWith("@") && !isXUrl && SOLANA.test(s) && s.length >= 32) {
    return { kind: "token", ref: s, via: "solana" };
  }
  if (!s.startsWith("@") && !isXUrl && TOKEN_CANDIDATE.test(s)) {
    return { kind: "token", ref: s, via: "address-candidate" };
  }
  const NOISE = /^(home|explore|notifications|messages|i|intent|search|hashtag|settings|share|status|about|tos|privacy)$/i;
  const xHandle = isXUrl && parsedUrl ? parsedUrl.pathname.split("/").filter(Boolean)[0] ?? "" : "";
  if (/^[A-Za-z0-9_]{1,30}$/.test(xHandle) && !NOISE.test(xHandle)) {
    return { kind: "handle", ref: xHandle };
  }
  if (HTTP_URL.test(s)) return { kind: "site", ref: s };
  if (!s.startsWith("@") && DOMAIN.test(s) && !NAME_SERVICE.test(s)) return { kind: "site", ref: s };
  return { kind: "handle", ref: s.replace(/^@/, "") };
}
export {
  auditToken,
  providerStatus,
  resolveInput,
  runAudit
};
