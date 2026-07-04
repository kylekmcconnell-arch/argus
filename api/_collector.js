// server/config.ts
var PROVIDERS = [
  { id: "grok", label: "Grok (X content)", env: ["XAI_API_KEY"], free: false, feeds: "testimonial acknowledgment, recent activity, sentiment" },
  { id: "twitterapi", label: "twitterapi.io (X follow graph)", env: ["TWITTERAPI_KEY"], free: false, feeds: "follower/following graph, profile, account age" },
  { id: "coingecko", label: "CoinGecko", env: ["COINGECKO_API_KEY"], free: true, feeds: "token price/mcap, call performance (K2)" },
  { id: "cryptorank", label: "CryptoRank", env: ["CRYPTORANK_API_KEY"], free: false, feeds: "market intel: rank, ATH drawdown, dilution, unlock/vesting flags" },
  { id: "dexscreener", label: "DexScreener", env: [], free: true, feeds: "live DEX liquidity/volume, rug signals" },
  { id: "crunchbase", label: "Crunchbase", env: ["CRUNCHBASE_API_KEY"], free: false, feeds: "ventures, investors, repeat backing (F2/F3/I2)" },
  { id: "peopledatalabs", label: "People Data Labs", env: ["PDL_API_KEY"], free: false, feeds: "identity, off-LinkedIn career history (F1/F2)" },
  { id: "github", label: "GitHub forensics", env: ["GITHUB_TOKEN"], free: false, feeds: "twitter-linked identity, org/repo affiliations (F1/F2)" },
  { id: "reddit", label: "Reddit", env: ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET"], free: true, feeds: "community FUD / reputation (F5/I5/AG4)" },
  { id: "helius", label: "Helius (Solana)", env: ["HELIUS_API_KEY"], free: true, feeds: "wallet forensics, on-chain conduct (K4)" },
  { id: "bitquery", label: "Bitquery (multi-chain)", env: ["BITQUERY_API_KEY"], free: false, feeds: "deployer/holder forensics, rug confirmation" },
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
  investigator_verified_fraud: 10
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
    caps: { prior_rug_as_principal: 10 },
    flags: [
      "serial failure pattern: repeated silent shutdowns with no exits",
      "any prior rug or exit scam as a named principal",
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
  const text = (bio || "").toLowerCase();
  const scores = Object.fromEntries(
    Object.values(SubjectClass).map((c) => [c, 0])
  );
  for (const cls of Object.keys(PATTERNS)) {
    for (const p of PATTERNS[cls]) {
      if (p.test(text)) scores[cls] += 1;
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
  const h = (handle + _counter).split("").reduce((a, c) => a * 33 + c.charCodeAt(0) >>> 0, 5381);
  return "PA-" + h.toString(16).toUpperCase().padStart(8, "0").slice(0, 12);
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
  setAxis(axis, score, rationale = "") {
    const role = classForAxis(axis);
    if (!this.roles.includes(role)) {
      throw new Error(`axis ${axis} belongs to ${role}, not a held role`);
    }
    const w = getProfile(role).axes[axis];
    this.axisScores[axis] = {
      score: Math.max(0, Math.min(score, w)),
      weight: w,
      rationale,
      role
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
      (f) => f.finding_type === ftype && f.verification_status === status && f.independent_source_count >= n
    );
    if (has("DeceptionFinding", "Verified")) keys.push("deception_confirmed");
    if (has("InvestigatorCallout", "Verified", 2)) keys.push("investigator_verified_fraud");
    return keys;
  }
  roleCapsTriggered(role) {
    const keys = [];
    if (role === "FOUNDER" /* FOUNDER */) {
      if (this.ventures.some((v) => v.outcome === "Rug" /* RUG */)) keys.push("prior_rug_as_principal");
    } else if (role === "KOL" /* KOL */) {
      if (this.wallets.some(
        (w) => w.sold_into_own_promo && (w.link_tier === "SelfDoxxed" || w.link_tier === "InvestigatorAttributed")
      ))
        keys.push("wallet_sold_into_promo");
      if (this.promotions.some((p) => p.paid_promo && p.outcome_was_rug))
        keys.push("paid_to_shill_confirmed_rug");
    } else if (role === "INVESTOR" /* INVESTOR */) {
      if (this.testimonials.some((t) => t.corroboration_verdict === "Contradicted" /* CONTRADICTED */))
        keys.push("contradicted_testimonial");
      if (this.findings.some((f) => f.finding_type === "PredatoryTerms" && f.verification_status === "Verified"))
        keys.push("predatory_terms_verified");
    } else if (role === "ADVISOR" /* ADVISOR */) {
      if (this.advisedProjects.some((p) => p.corroboration_verdict === "Contradicted" /* CONTRADICTED */))
        keys.push("claimed_advisory_contradicted");
      if (this.advisedProjects.some((p) => p.project_outcome === "Rug" && p.paid_or_allocated))
        keys.push("advised_rug_with_allocation");
    } else if (role === "AGENCY" /* AGENCY */) {
      if (this.clientEngagements.some((c) => c.manipulation_service_flag))
        keys.push("market_manipulation_services");
    }
    return keys;
  }
  identityBlocks() {
    return this.identity === "SuspectedImpersonation";
  }
  finalize() {
    const identity = this.identity;
    const sharedKeys = this.sharedCapsTriggered();
    const doxBonus = identity ? DOX_BONUS[identity] ?? 0 : 0;
    const roleReports = [];
    for (const role of this.roles) {
      const axes = {};
      for (const [ax, a] of Object.entries(this.axisScores)) {
        if (classForAxis(ax) === role) axes[ax] = a;
      }
      if (Object.keys(axes).length === 0) {
        roleReports.push({
          role,
          verdict: "INCOMPLETE",
          raw_total: null,
          score_total: null,
          cap_applied: null,
          dox_bonus: doxBonus,
          axes: {}
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
    if (scored.length) {
      const governing = scored.reduce((m, r) => SEVERITY[r.verdict] > SEVERITY[m.verdict] ? r : m);
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
      finalized_at: (/* @__PURE__ */ new Date(0)).toISOString()
    };
    if (this.roles.includes("FOUNDER" /* FOUNDER */)) report.founder_summary = this.founderSummary();
    if (this.roles.includes("ADVISOR" /* ADVISOR */)) report.advised_summary = this.advisedOutcomeSummary();
    return report;
  }
  publishable() {
    return this.findings.filter(
      (f) => f.independent_source_count >= 1 && (f.verification_status === "Verified" || f.verification_status === "Reported")
    );
  }
  toPanoptes() {
    const nodes = [{ type: "Person", key: this.handle, roles: this.roles, subject: true }];
    const edges = [];
    for (const a of this.associates) {
      nodes.push({ type: "Person", key: a.associate_key, in_cabal_kb: !!a.in_cabal_kb });
      edges.push({ src: this.handle, dst: a.associate_key, type: "ASSOCIATES_WITH", relation: a.relation });
    }
    for (const v of this.ventures) {
      nodes.push({ type: "Company", key: v.project_name, outcome: v.outcome });
      edges.push({ src: this.handle, dst: v.project_name, type: "FOUNDED", outcome: v.outcome });
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
      const key = p.project_handle || p.project_name;
      nodes.push({ type: "Company", key, outcome: p.project_outcome });
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
    for (const f of this.findings.filter((x) => x.finding_type === "DeceptionFinding")) {
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

// src/data/dossier.ts
function assembleDossier(ev, live) {
  const a = new Audit(ev.profile.handle, { roles: ev.roles, display_name: ev.profile.display_name });
  a.setIdentity(ev.profile.identity_confidence);
  ev.ventures.forEach((v) => a.addVenture(v));
  ev.testimonials.forEach((t) => a.addTestimonial(t));
  ev.advised.forEach((p) => a.addAdvisedProject(p));
  ev.wallets.forEach((w) => a.addWallet(w));
  ev.promotions.forEach((p) => a.addPromotion(p));
  ev.clientEngagements.forEach((c) => a.addClientEngagement(c));
  ev.associates.forEach((as) => a.addAssociate(as));
  ev.findings.forEach((f) => a.addFinding(f));
  ev.axes.forEach((ax) => {
    try {
      a.setAxis(ax.axis, ax.score, ax.rationale);
    } catch {
    }
  });
  const report = a.finalize();
  const graph = a.toPanoptes();
  const subjectKey = graph.nodes.find((n) => n.subject)?.key ?? ev.profile.handle;
  const hasNode = (key) => graph.nodes.some((n) => String(n.key).toLowerCase() === key.toLowerCase());
  for (const p of ev.webTeam ?? []) {
    const pkey = p.handle ?? p.name;
    if (!pkey) continue;
    if (!hasNode(pkey)) graph.nodes.push({ type: "Person", key: pkey, role: p.role });
    graph.edges.push({ src: subjectKey, dst: pkey, type: "TEAM", role: p.role });
    for (const pr of p.projects ?? []) {
      if (!pr.name) continue;
      if (!hasNode(pr.name)) graph.nodes.push({ type: "Company", key: pr.name });
      graph.edges.push({ src: pkey, dst: pr.name, type: "WORKED_ON", role: pr.role });
    }
  }
  for (const email of ev.profile.identity_emails ?? []) {
    const ekey = `email:${email.toLowerCase()}`;
    if (!hasNode(ekey)) graph.nodes.push({ type: "Identity", subtype: "Email", key: ekey, label: email });
    graph.edges.push({ src: subjectKey, dst: ekey, type: "IDENTITY_EMAIL" });
  }
  return {
    handle: ev.profile.handle,
    display_name: ev.profile.display_name,
    avatar: ev.profile.avatar,
    avatar_url: ev.profile.avatar_url,
    bio: ev.profile.bio,
    followers: ev.profile.followers,
    joined: ev.profile.joined,
    days_since_post: ev.profile.days_since_post,
    identity_note: ev.profile.identity_note,
    prior_handles: ev.profile.prior_handles,
    headline: ev.headline,
    live,
    notableFollowers: ev.notableFollowers,
    contradictions: ev.contradictions,
    webTeam: ev.webTeam ?? [],
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
    contradictions: []
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
    { axis: "F3_repeat_backing", score: 11, rationale: "Dragonfly backed both Meridian and Lumen \u2014 a returning backer from a successful exit (strong signal)." },
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
    { axis: "AD3_relationship_corroboration", score: 18, rationale: "Both advised projects publicly acknowledge the relationship \u2014 the claims are real." },
    { axis: "AD4_advisory_conduct", score: 8, rationale: "Held a vested allocation in ZenithDAO; allocation conduct around the rug is the concern." },
    { axis: "AD5_reputation_fud", score: 9, rationale: "Named in post-rug community threads about ZenithDAO advisors." }
  ],
  trace: [
    { phase: "P0 \xB7 Intake", label: "Resolve handle", detail: "@0xlumen \u2192 canonical key. Cross-referencing roster KB across 1,204 entries.", tone: "neutral" },
    { phase: "P0 \xB7 Routing", label: "Classify roles", detail: "Bio signals: founder, GP, advisor. Routed to 3 tracks \u2014 FOUNDER, INVESTOR, ADVISOR.", tone: "neutral" },
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
    { phase: "P0 \xB7 Routing", label: "Classify roles", detail: "Bio signals founder/CEO. Single track \u2014 FOUNDER.", tone: "neutral" },
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
    { phase: "P0 \xB7 Intake", label: "Resolve handle", detail: "@nova_capital \u2192 canonical key. Account created Sep 2023 vs. '40+ winners' claim \u2014 flag the mismatch.", tone: "warn" },
    { phase: "P0 \xB7 Routing", label: "Classify roles", detail: "Fund / investor signals. Single track \u2014 INVESTOR.", tone: "neutral" },
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
    a.addClientEngagement({ client_name: "ZenithDAO", service_type: "market_making", manipulation_service_flag: true, notes: "Sold 'volume' for ZenithDAO in the weeks before its LP was drained \u2014 the same project @0xlumen advised.", evidence_url: "https://x.com/zachxbt/delta-volume" });
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
    { phase: "P0 \xB7 Routing", label: "Classify roles", detail: "Agency / growth / market-making signals. Single track \u2014 AGENCY.", tone: "neutral" },
    { phase: "Agency", label: "Service integrity", detail: "Site openly sells 'volume' and 'trending' tiers \u2014 parsing for manipulation services\u2026", tone: "warn" },
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
function emptyEvidence(handle) {
  const u = handle.replace(/^@/, "");
  return {
    profile: {
      handle: handle.startsWith("@") ? handle : "@" + u,
      display_name: u,
      avatar: u.slice(0, 1).toUpperCase(),
      bio: "",
      followers: "\u2014",
      joined: "\u2014",
      identity_confidence: "Unverified",
      identity_note: "No identity resolution available."
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
    contradictions: []
  };
}

// server/cost.ts
var PRICE = {
  grokIn: 0.2 / 1e6,
  grokOut: 0.5 / 1e6,
  grokSource: 25 / 1e3,
  claudeIn: 3 / 1e6,
  claudeOut: 15 / 1e6,
  twitterapiCall: 2e-4,
  pdlMatch: 0.1,
  heliusCall: 1e-4
};
var EST_SOURCES_PER_SEARCH = 5;
var ledger = /* @__PURE__ */ new Map();
var grok = { in: 0, out: 0, calls: 0, sources: 0 };
var claude = { in: 0, out: 0, calls: 0 };
function resetCost() {
  ledger = /* @__PURE__ */ new Map();
  grok = { in: 0, out: 0, calls: 0, sources: 0 };
  claude = { in: 0, out: 0, calls: 0 };
}
function recordCall(provider, op, usd = 0, meta) {
  const key = `${provider}|${op}`;
  const cur = ledger.get(key);
  if (cur) {
    cur.calls += 1;
    cur.usd += usd;
    if (meta) cur.meta = meta;
  } else {
    ledger.set(key, { provider, op, calls: 1, usd, meta });
  }
}
function recordTwitterapi(op) {
  recordCall("twitterapi", op, PRICE.twitterapiCall);
}
function addGrokUsage(u, toolCalls, op = "live-search") {
  const tin = u?.input_tokens ?? 0;
  const tout = u?.output_tokens ?? 0;
  const sources = typeof u?.num_sources_used === "number" ? u.num_sources_used : (toolCalls ?? 0) * EST_SOURCES_PER_SEARCH;
  grok.calls += 1;
  grok.in += tin;
  grok.out += tout;
  grok.sources += sources;
  recordCall("grok", op, tin * PRICE.grokIn + tout * PRICE.grokOut + sources * PRICE.grokSource, `${tin + tout} tok \xB7 ~${sources} sources`);
}
function addClaudeUsage(u, op = "analysis") {
  const tin = u?.input_tokens ?? 0;
  const tout = u?.output_tokens ?? 0;
  claude.calls += 1;
  claude.in += tin;
  claude.out += tout;
  recordCall("claude", op, tin * PRICE.claudeIn + tout * PRICE.claudeOut, `${tin + tout} tok`);
}
function recordPdlMatch(matched) {
  recordCall("peopledatalabs", "person/enrich", matched ? PRICE.pdlMatch : 0, matched ? "per-match est" : "no match (free)");
}
function recordHelius(op) {
  recordCall("helius", op, PRICE.heliusCall);
}
var round4 = (n) => Math.round(n * 1e4) / 1e4;
function getCost() {
  const lines = [...ledger.values()].map((l) => ({ ...l, usd: round4(l.usd) })).sort((a, b) => b.usd - a.usd || b.calls - a.calls);
  const grokUsd = lines.filter((l) => l.provider === "grok").reduce((a, l) => a + l.usd, 0);
  const claudeUsd = lines.filter((l) => l.provider === "claude").reduce((a, l) => a + l.usd, 0);
  const total = lines.reduce((a, l) => a + l.usd, 0);
  const round2 = (n) => Math.round(n * 100) / 100;
  return {
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

// server/agent.ts
var ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
function analystAvailable() {
  return !!env("ANTHROPIC_API_KEY");
}
async function structured(system, user, tool, maxTokens = 2048) {
  const key = env("ANTHROPIC_API_KEY");
  if (!key) return null;
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: ANALYST_MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
        tools: [tool],
        tool_choice: { type: "tool", name: tool.name }
      })
    });
    if (!res.ok) {
      console.error("[agent] anthropic error", res.status, await res.text());
      return null;
    }
    const data = await res.json();
    addClaudeUsage(data.usage, tool.name);
    const block = data.content.find((b) => b.type === "tool_use");
    return block?.input ?? null;
  } catch (e) {
    console.error("[agent] request failed", e);
    return null;
  }
}
async function extractClaims(handle, bio, posts) {
  const system = "You are ARGUS intake. From a subject's own bio and recent posts, extract the claims they make about themselves so they can be verified later. Capture CLAIMS ONLY, never judge truth. Roles drawn from: FOUNDER, PROJECT, KOL, INVESTOR, ADVISOR, AGENCY, MEMBER. Classify the ACCOUNT TYPE precisely: PROJECT = the account IS an organization \u2014 a token, protocol, product, company, or DAO's own brand/official handle (usually named after the project, speaks as 'we/our', ships and promotes its OWN single token/product). FOUNDER = an individual PERSON who founded or leads a project (a personal account, speaks as 'I'). KOL = an influencer/caller whose activity is promoting OTHER people's tokens across MANY different projects (calls, alpha, gems, paid shills for others), NOT their own. INVESTOR = PROFESSIONAL capital allocation ONLY: an actual fund/VC/syndicate (or its official brand account), a GP/partner/principal at one, or an angel with NAMED, verifiable investments (led or joined specific rounds). Buying/trading tokens, 'investing in gems', or calling oneself an investor with no documented deals is NOT INVESTOR \u2014 a caller who trades is a KOL, nothing more. Decisive rules: a brand account promoting its own token is PROJECT (never KOL); an investment firm's brand account is INVESTOR, NOT PROJECT (PROJECT is for accounts shipping a product/token, not allocating capital); an individual builder is FOUNDER; only tag KOL when they shill multiple external tokens they did not build. A subject can hold several roles, but do not tag KOL merely for hype words or for promoting the project's own token, and do not tag INVESTOR merely for trading talk. Ventures = companies/projects they say they founded or led. Testimonials = named people/accounts they cite as backers or endorsers. Advised = projects they claim to advise. Promotions = tokens/tickers they shill; for a prolific caller capture EVERY distinct token they promoted (each cashtag / chart-link post is a call), not just a few, listing each ticker once with its contract address and chain when a chart link or CA is present. Use the @handle form for accounts. Omit anything not actually claimed. Never use em dashes.";
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
async function scanContradictions(handle, evidenceJson) {
  const system = "You are ARGUS contradiction analysis. From everything collected about a subject, find INTERNAL CONTRADICTIONS: where the subject's own stated claims conflict with each other or with the collected evidence. Examples: claims a team of N but only one builder is found; claims an audit but no auditor or verification exists; claims a named backer who never acknowledges them; a stated launch/founding date that conflicts with the account age, domain age, or on-chain history; claims 'doxxed' but no real identity resolves; claims locked liquidity that on-chain shows unlocked; a partnership the partner never confirmed; a venture in the bio that discovery found no evidence for. Be STRICT and grounded: report ONLY genuine contradictions, each with the EXACT claim and the EXACT conflicting fact from the evidence. A missing or unverifiable data point is a GAP, not a contradiction; never report gaps, and never invent. If there are none, return an empty list. Never use em dashes. SCOPE RULES \u2014 these are NOT contradictions: (1) ARGUS's OWN analysis metadata (fields like identity_confidence, identity_note, verdicts, evidence notes such as 'single-source lead, unverified') disagreeing with other ARGUS fields \u2014 only the SUBJECT's outward claims vs external facts count; a low-confidence evidence note is a gap, not a conflict. (2) Normal vertical integration: a project's token running on its own chain, its dApp on its own platform, or its products naming each other is how ecosystems work, not circularity. (3) Marketing self-description ('#1', 'leading') vs modest traction is puffery to note in scoring, not a contradiction, unless it conflicts with a specific verifiable fact.";
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
  const r = await structured(system, user, tool, 2048);
  if (!r) return null;
  return (r.contradictions ?? []).filter((c) => c && c.claim?.trim() && c.conflict?.trim()).map((c) => ({ claim: c.claim.trim(), conflict: c.conflict.trim(), severity: lvl(c.severity), confidence: lvl(c.confidence) })).slice(0, 10);
}
async function analyzeSubject(handle, roles, axisCatalog2, evidenceJson) {
  const system = "You are ARGUS, a forensic crypto due-diligence analyst. You score a subject on a fixed set of axes from collected evidence only. Be skeptical: a strong story never papers over a disqualifying fact. Score conservatively when evidence is thin. Each axis score must be between 0 and its weight. Write one tight rationale per axis citing the evidence. Never use em dashes.";
  const user = `Subject: ${handle}
Held roles: ${roles.join(", ")}

Axes to score (axis | weight | role):
` + axisCatalog2.map((a) => `- ${a.axis} | max ${a.weight} | ${a.role}`).join("\n") + `

Collected evidence (JSON):
${evidenceJson}

Score every listed axis, write the composite headline (one sentence on what governs the verdict), and an identity note.

ACTIVITY RULE: weigh posting cadence. profile.days_since_post is how long the account has been silent. For a PROJECT/token, going quiet for weeks (roughly 21+ days) is a real liveness flag (abandoned, winding down, or quiet after a raise) and should temper traction/execution axes; for an individual it is a milder signal. Recent, steady posting is mildly positive, not a free pass.

IDENTITY RULE: if the evidence has a "team" array of named people tied to the project (especially any with a LinkedIn, or a named founder/CEO/CTO), the project's real-world identity is RESOLVED. A pseudonymous brand/company handle run on behalf of a publicly named team is NORMAL and is NOT an anonymity red flag: do not score identity/backing axes as if the operators were anonymous, and do NOT write a headline that calls the founder identity "unresolved", "unnamed", or "anonymous" when named leaders are present. Only treat identity as unresolved when the evidence genuinely names no one behind the project.`;
  const tool = {
    name: "record_verdict",
    description: "Record the per-axis scores, headline, and identity note.",
    input_schema: {
      type: "object",
      properties: {
        axes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              axis: { type: "string" },
              score: { type: "number" },
              rationale: { type: "string" }
            },
            required: ["axis", "score", "rationale"]
          }
        },
        headline: { type: "string" },
        identity_note: { type: "string", description: "Identity resolution. Distinguish the ACCOUNT OPERATOR from the project's TEAM: if named team members are present in the evidence (especially with a LinkedIn), acknowledge them by name and do NOT claim 'no linked real-world identity' or 'zero credentials' \u2014 instead say the account/operator is pseudonymous while N named people are publicly tied to the project (list a few). Only say no one is identified if the evidence truly has no named people." }
      },
      required: ["axes", "headline", "identity_note"]
    }
  };
  return structured(system, user, tool, 3e3);
}

// server/cache.ts
import { createHash } from "node:crypto";
var TTL_MS = 24 * 3600 * 1e3;
var KIND = "grokcache";
function creds() {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SERVICE_KEY");
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}
var headers = (key) => ({ apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" });
var hash = (s) => "g:" + createHash("sha256").update(s).digest("hex").slice(0, 40);
async function cacheGet(key) {
  const c = creds();
  if (!c) return null;
  try {
    const r = await fetch(
      `${c.url}/rest/v1/reports?select=payload&ref=eq.${encodeURIComponent(hash(key))}&kind=eq.${KIND}&limit=1`,
      { headers: headers(c.key), signal: AbortSignal.timeout(4e3) }
    );
    if (!r.ok) return null;
    const rows = await r.json();
    const p = rows?.[0]?.payload;
    if (!p?.text || typeof p.at !== "number" || Date.now() - p.at > TTL_MS) return null;
    recordCall("cache", "grok-hit", 0, "24h search cache");
    return p.text;
  } catch {
    return null;
  }
}
async function cacheSet(key, text) {
  const c = creds();
  if (!c || !text) return;
  try {
    await fetch(`${c.url}/rest/v1/reports?on_conflict=ref,kind`, {
      method: "POST",
      headers: { ...headers(c.key), prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ ref: hash(key), kind: KIND, query: key.slice(0, 180), payload: { text, at: Date.now() }, ts: (/* @__PURE__ */ new Date()).toISOString() }),
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
async function grokSearch(system, user, opts) {
  const key = env("XAI_API_KEY");
  if (!key) return null;
  if (opts?.cacheKey) {
    const hit = await cacheGet(opts.cacheKey);
    if (hit) return hit;
  }
  try {
    const call = (withCap) => fetch("https://api.x.ai/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: env("ARGUS_GROK_MODEL") || "grok-4-fast",
        input: [{ role: "system", content: system }, { role: "user", content: user }],
        tools: [{ type: "web_search" }, { type: "x_search" }],
        ...withCap ? { max_tool_calls: opts?.maxToolCalls ?? 4 } : {}
      }),
      signal: AbortSignal.timeout(45e3)
    });
    let res = await call(true);
    if (res.status === 400) res = await call(false);
    if (!res.ok) return null;
    const d = await res.json();
    try {
      const toolCalls = Array.isArray(d.output) ? d.output.filter((o) => /search|tool/.test(String(o.type ?? ""))).length : void 0;
      console.log("[grok-usage]", JSON.stringify({ in: d.usage?.input_tokens, out: d.usage?.output_tokens, toolCalls }));
      addGrokUsage(d.usage, toolCalls);
    } catch {
    }
    const text = d.output_text ?? (Array.isArray(d.output) ? d.output.flatMap((o) => o.content ?? []).map((c) => c.text ?? "").join(" ") : "") ?? "";
    if (text && opts?.cacheKey) void cacheSet(opts.cacheKey, text);
    return text || null;
  } catch {
    return null;
  }
}
async function twFetch(url, key, tries = 2) {
  recordTwitterapi(url.match(/\/twitter\/([a-z_/]+)/i)?.[1] ?? "other");
  let last = null;
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { headers: { "x-api-key": key } });
    last = res;
    if (res.status !== 429 && res.status !== 502 && res.status !== 503) return res;
    await new Promise((r) => setTimeout(r, res.status === 429 ? 1200 : 700 * (i + 1)));
  }
  return last;
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
  try {
    recordCall("memory.lol", "tw-history", 0);
    const res = await fetch(`https://api.memory.lol/v1/tw/${encodeURIComponent(u)}`, { signal: AbortSignal.timeout(8e3) });
    if (!res.ok) return null;
    const d = await res.json();
    const acct = (d.accounts ?? [])[0];
    if (!acct?.screen_names) return { priorHandles: [], idStr: acct?.id_str };
    const names = Object.keys(acct.screen_names);
    const prior = names.filter((n) => n.toLowerCase() !== u.toLowerCase());
    return { priorHandles: prior, idStr: acct.id_str };
  } catch {
    return null;
  }
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
var num = (...v) => {
  for (const x of v) if (typeof x === "number") return x;
  return void 0;
};
var KW_IDENTITY = ["founder", "co-founder", "cofounder", "CEO", "CTO", "advisor", '"I built"', '"we built"', '"joined as"', "founded"];
var KW_LAUNCH = ["launching", "presale", "mint", "airdrop", "raised", "seed", "IDO", '"CA:"', "tokenomics", "whitelist"];
var KW_ENDORSE = ["backed", "investors", "partnership", "gem", "100x", '"proud to"'];
var KW_SHILL = ["aped", "sending", '"the play"', "entry", "accumulated", "conviction", "printing", "pumping", "calling", "chart", '"my bag"', "loaded"];
var KW_CALLS = ["dexscreener.com", "pump.fun", "birdeye.so", "dextools.io", "geckoterminal.com", "photon-sol", '"CA"'];
var CLAIM_RE = /\b(founder|co-?founder|ceo|cto|advisor|founded|building|built|launch|presale|mint|airdrop|raised|seed|series [a-d]|ido|tokenomics|backed|investors?|partnership|gem|100x|joined|aped?|shill|calling|conviction|printing|pumping|sending it)\b/i;
function parseTweet(t) {
  const text = (t.text ?? t.full_text ?? "").trim();
  const at = Date.parse(t.createdAt ?? t.created_at ?? "");
  const isRt = /^RT @/.test(text) || !!t.retweeted_tweet || !!t.retweeted_status || t.isRetweet === true;
  const isReply = !!(t.isReply ?? t.inReplyToId ?? t.in_reply_to_status_id ?? t.in_reply_to_user_id) || /^@\w/.test(text);
  return {
    text,
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
  recordTwitterapi("tweet/advanced_search");
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
async function checkFollow(source, target) {
  const key = env("TWITTERAPI_KEY");
  if (!key) return null;
  const s = source.replace(/^@/, "");
  const t = target.replace(/^@/, "");
  try {
    const res = await twFetch(`${TWITTERAPI}/twitter/user/check_follow_relationship?source_user_name=${encodeURIComponent(s)}&target_user_name=${encodeURIComponent(t)}`, key);
    if (!res || !res.ok) return null;
    const d = await res.json();
    if (d?.status === "error") return null;
    const raw = d?.data ?? d ?? {};
    const pick = (...keys) => {
      for (const k of keys) if (typeof raw[k] === "boolean") return raw[k];
      return null;
    };
    const following = pick("following", "is_following", "isFollowing", "follows", "source_following_target");
    const followedBy = pick("followed_by", "is_followed_by", "isFollowedBy", "followed", "target_following_source");
    if (following === null && followedBy === null) {
      console.log("[check-follow] unrecognized shape:", JSON.stringify(raw).slice(0, 200));
      return null;
    }
    return { following, followedBy };
  } catch {
    return null;
  }
}
async function dynamicNotable() {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SERVICE_KEY");
  if (!url || !key) return [];
  const cached = await cacheGet("notable:dynamic");
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
    }
  }
  try {
    const r = await fetch(`${url}/rest/v1/reports?select=ref,score&kind=eq.person&verdict=eq.PASS&order=score.desc&limit=600`, {
      headers: { apikey: key, authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8e3)
    });
    if (!r.ok) return [];
    const rows = await r.json();
    const accts = rows.filter((x) => x && typeof x.ref === "string" && /^@?[A-Za-z0-9_]{2,30}$/.test(x.ref)).map((x) => ({ handle: x.ref.replace(/^@/, ""), label: "ARGUS-verified" }));
    await cacheSet("notable:dynamic", JSON.stringify(accts));
    return accts;
  } catch {
    return [];
  }
}
async function notableFollowers(subject, opts) {
  const key = env("TWITTERAPI_KEY");
  if (!key) return { list: [], checked: 0 };
  const subj = subject.replace(/^@/, "").toLowerCase();
  const seen = /* @__PURE__ */ new Set();
  const candidates = [...NOTABLE_ACCOUNTS, ...await dynamicNotable()].filter((n) => {
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
    for (let page = 0; page < enumPages + 2; page++) {
      const url = `${TWITTERAPI}/twitter/user/followers?userName=${encodeURIComponent(u)}&pageSize=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const res = await twFetch(url, key);
      if (!res || !res.ok) break;
      const d = await res.json();
      const followers = d.followers ?? d.data?.followers ?? [];
      if (!followers.length) break;
      for (const f of followers) {
        const h = String(f.userName ?? f.screen_name ?? "").toLowerCase();
        const m = set.get(h);
        if (m && !got.has(h)) {
          got.add(h);
          hits2.push({ handle: m.handle, label: m.label, size: "" });
        }
      }
      if (!d.has_next_page || !d.next_cursor) break;
      cursor = d.next_cursor;
    }
    return { list: hits2, checked: total };
  }
  const REVERSE_CAP = 500;
  const toCheck = candidates.slice(0, REVERSE_CAP);
  const hits = [];
  const CHUNK = 15;
  for (let i = 0; i < toCheck.length; i += CHUNK) {
    const res = await Promise.all(
      toCheck.slice(i, i + CHUNK).map(async (n) => {
        const rel = await checkFollow(n.handle, subject);
        return rel?.following ? { handle: n.handle, label: n.label, size: "" } : null;
      })
    );
    for (const r of res) if (r) hits.push(r);
  }
  return { list: hits, checked: toCheck.length };
}
async function acknowledgments(endorsers, subject) {
  const out = /* @__PURE__ */ new Map();
  const key = env("XAI_API_KEY");
  const list = [...new Set(endorsers.map((e) => e.replace(/^@/, "")).filter(Boolean))];
  if (!key || !list.length) return out;
  const s = subject.replace(/^@/, "");
  const system = "You verify endorsements for a due-diligence engine, with live web and X search. For EACH listed account, decide the strongest public acknowledgment that account has ever made of @" + s + ' on X, and its overall sentiment. ack is one of none|mention|thanks|endorsement; sentiment is positive|neutral|negative|none. Reply with ONLY compact JSON: {"results":[{"handle":"@...","ack":"none|mention|thanks|endorsement","sentiment":"positive|neutral|negative|none"}]} \u2014 one entry per listed account, never invent posts.';
  const text = await grokSearch(system, `Accounts to check: ${list.map((e) => "@" + e).join(", ")}. For each: has it ever publicly acknowledged @${s} on X? Search each account's posts.`, { maxToolCalls: Math.min(6, list.length + 1), cacheKey: `ack:${s}:${[...list].sort().join(",")}` });
  if (!text) return out;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return out;
  try {
    const arr = JSON.parse(m[0]).results ?? [];
    for (const r of arr) {
      const h = typeof r?.handle === "string" ? r.handle.replace(/^@/, "").toLowerCase() : "";
      if (!h) continue;
      out.set(h, { ack: r.ack ?? "none", sentiment: r.sentiment ?? "none" });
    }
  } catch {
  }
  return out;
}
async function discoverAffiliations(handle, name, oldHandles = []) {
  const h = handle.replace(/^@/, "");
  const aliasLine = oldHandles.length ? ` This SAME person previously used these X handles: ${oldHandles.map((o) => "@" + o).join(", ")} \u2014 search posts mentioning those old handles too.` : "";
  const system = `You are a forensic due-diligence researcher with live web and X search. Find EVERY company, crypto project, fund, DAO, or venture that THIS SPECIFIC person (the holder of the given X account) is publicly tied to in ANY working capacity: founded, co-founded, led, was an early employee of, worked at, contributed to, was a core team member of, or advised. Work BOTH angles: (1) what the person's own footprint shows \u2014 accelerator/portfolio pages, press, team pages, GitHub orgs, podcasts, Crunchbase, beyond their bio and LinkedIn; (2) reverse mentions \u2014 project/company accounts that ever NAMED, TAGGED, or ANNOUNCED this person as a founder/team member (co-founder announcements and 'meet the team' posts are often YEARS old, on the project's timeline, search historical posts). There MUST be public evidence tying THAT EXACT person to the venture. For each, also report the venture's own X handle and website domain if you can find them. Reply with ONLY compact JSON: {"affiliations":[{"name":"","role":"founder|cofounder|exec|employee|engineer|contributor|advisor|affiliate","year":"","evidence":"one short source phrase","x_handle":"@...","domain":"example.com"}]}. Include ONLY affiliations you found real, attributable evidence for. If you cannot confidently tie a venture to THIS person, omit it. If you find nothing, return {"affiliations":[]}. NEVER invent, guess, or include a venture just because the name is common. Never use em dashes.`;
  const text = await grokSearch(system, `Person: ${name || h} (X handle @${h}).${aliasLine} Every company or project they have founded, led, worked at, contributed to, or advised, however small the role \u2014 from their own footprint AND from project accounts announcing them. Search the web and X including historical posts.`, { maxToolCalls: 6, cacheKey: `affil:${h}:${oldHandles.join(",")}` });
  if (!text) return [];
  const m = text.match(/\{[\s\S]*\}/);
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
  const system = `You are a forensic researcher with live X search. Identify the PEOPLE publicly tied to the project behind the given X account: founders, cofounders, core team, engineers, AND advisors/backers. Look especially at the account's OWN posts (team intros, 'welcome @x as our CTO', 'our founder @y', 'advised by @z', 'backed by @w') and posts that tag these people, plus posts mentioning the project that name its people. Be PRECISE about each person's role AT THIS project: only call someone an advisor if they are actually named as one; if they are a founder/cofounder, say so \u2014 do NOT downgrade a founder to advisor. For EACH person also list their OTHER notable projects or companies (name + their role there, e.g. founder/cofounder/advisor/engineer) that live web/X search reveals \u2014 this exposes serial founders and cross-project ties. Include ONLY people with real public evidence tying them to THIS project. EXCLUDE the project account itself, generic shillers, hype repliers, and unrelated mentions. Reply with ONLY compact JSON: {"people":[{"name":"","handle":"@...","linkedin":"linkedin.com/in/...","role":"founder|cofounder|ceo|cto|engineer|advisor|backer","kind":"team|advisor","evidence":"","projects":[{"name":"","role":""}]}]}. If none, return {"people":[]}. NEVER invent. Never use em dashes.`;
  const text = await grokSearch(system, `X account: @${h}${name && name !== h ? ` (${name})` : ""}. Who are the founders, team members, and advisors of this project? Give each person's precise role here AND their other projects. Search the account's own posts and posts mentioning it.${postContext}`, { cacheKey: `team-x:${h}` });
  return parseTeamJSON(text, h, "X content");
}
async function findTeamOnSite(domain, projectName) {
  const clean = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
  if (!clean && !projectName) return [];
  const anchor = clean ? `website ${clean}${projectName ? ` (${projectName})` : ""}` : `project "${projectName}"`;
  const system = `You are a forensic OSINT researcher with live web and X search. Find EVERY real person behind the crypto/tech project: founders, cofounders, the WHOLE leadership team (CEO/CTO/COO/CFO/CMO), engineering and product leads, AND advisors/backers. DIG hard and be COMPLETE: Google the project + 'team'/'leadership'/'about', open the project's LinkedIn company page and read its 'People' tab (list the employees it shows), check Crunchbase people, the GitHub org's members, podcasts/interviews/press, and X. For an established project expect to name SEVERAL people \u2014 do NOT stop at one or two; keep going until you have the full public roster you can verify. Connect each name to their X handle and LinkedIn where possible. Include ONLY real people genuinely tied to THIS specific project (match the domain/name; do not confuse same-named projects). EXCLUDE hype/shill accounts and generic mentions. Be PRECISE about each person's role AT THIS project: only call someone an advisor if the project actually names them as one; if the site/LinkedIn shows them as a founder/cofounder/CEO, use THAT \u2014 do NOT downgrade a founder to advisor. For EACH person, also list their OTHER notable projects/companies (name + their role there) that web/LinkedIn/Crunchbase reveal \u2014 this exposes serial founders and cross-project ties. Reply with ONLY compact JSON: {"people":[{"name":"","handle":"@...","linkedin":"linkedin.com/in/...","role":"","kind":"team|advisor","evidence":"","projects":[{"name":"","role":""}]}]}. If nobody, {"people":[]}. NEVER invent. Never use em dashes.`;
  const text = await grokSearch(system, `Crypto/tech ${anchor}. Find the COMPLETE public team: every founder, executive, core team member, and advisor behind it. Read its LinkedIn company People tab, Crunchbase, GitHub org, and press. Connect each to their X handle and LinkedIn, give each person's PRECISE role here, AND list their other projects. Name as many verifiable people as you can, not just the most famous one.`, { cacheKey: `team-site:${clean || projectName}` });
  return parseTeamJSON(text, void 0, clean ? "web/LinkedIn search" : "web/LinkedIn (by name)");
}
async function enrichTeamIdentities(project, people) {
  if (!people.length) return [];
  const system = `You are an OSINT researcher with live web and X search. For each named team member of the given project, find their X (Twitter) handle and LinkedIn profile. Match the RIGHT person: same name + same project/role (check bios, the project's follows, press). If you cannot confidently match one, omit that field rather than guess. Reply with ONLY compact JSON: {"people":[{"name":"","handle":"@...","linkedin":"linkedin.com/in/..."}]} \u2014 one entry per input name, fields omitted when unknown. NEVER invent. Never use em dashes.`;
  const list = people.map((p) => `${p.name}${p.role ? ` (${p.role})` : ""}`).join("; ");
  const text = await grokSearch(system, `Project: ${project}. Team members to resolve: ${list}. Find each person's X handle and LinkedIn.`, { cacheKey: `enrich:${project}:${people.map((p) => p.name).sort().join("|")}` });
  if (!text) return [];
  const m = text.match(/\{[\s\S]*\}/);
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
var ROLE_RE = /\b(co-?founders?|founders?|ceo|cto|coo|cfo|cmo|chief\s+\w+\s+officer|lead\s+(?:dev|developer|engineer)|core\s+(?:dev|team)|head\s+of\s+\w+|advisors?|our\s+(?:founder|ceo|cto|coo|team|dev|lead))\b/i;
function scanPostsForRoles(posts) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (m) => {
    const k = (m.handle ?? m.name).toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(m);
  };
  for (const raw of posts.slice(0, 25)) {
    const p = String(raw ?? "");
    const rm = p.match(ROLE_RE);
    if (!rm) continue;
    const role = rm[0].toLowerCase().replace(/^our\s+/, "");
    const kind = /advisor/i.test(role) ? "advisor" : "team";
    for (const hm of p.matchAll(/@([A-Za-z0-9_]{2,30})/g)) {
      add({ name: "@" + hm[1], handle: "@" + hm[1], role, kind, evidence: `role word "${role}" in the account's own post`, source: "post role-scan" });
    }
    const RW = "co-?founders?|founders?|ceo|cto|coo|cfo|cmo|advisors?";
    const nm = p.match(new RegExp(`([A-Z][a-z]+\\s+[A-Z][a-z]+)[^.\\n]{0,18}\\b(?:${RW})\\b|\\b(?:${RW})\\b[^.\\n]{0,12}([A-Z][a-z]+\\s+[A-Z][a-z]+)`, "i"));
    const name = nm ? nm[1] || nm[2] : void 0;
    if (name && /^[A-Z][a-z]+\s+[A-Z][a-z]+$/.test(name)) {
      add({ name, role, kind, evidence: `named next to the role word "${role}" in the account's own post`, source: "post role-scan" });
    }
  }
  return out.slice(0, 12);
}
function parseTeamJSON(text, selfHandle, source) {
  if (!text) return [];
  const m = text.match(/\{[\s\S]*\}/);
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
        source,
        projects: projects && projects.length ? projects : void 0
      };
    }).filter((t) => !t.handle || t.handle.replace(/^@/, "").toLowerCase() !== self).slice(0, 16);
  } catch {
    return [];
  }
}
function fmtFollowers(n) {
  if (n == null) return "\u2014";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}
var xAdapter = {
  id: "x",
  label: "X (Grok + twitterapi.io)",
  available: () => !!env("TWITTERAPI_KEY") || !!env("XAI_API_KEY"),
  async run(ctx) {
    const haveProfile = ctx.evidence.profile.followers && ctx.evidence.profile.followers !== "\u2014";
    const prof = haveProfile ? null : await getProfile2(ctx.handle);
    if (prof) {
      ctx.evidence.profile.display_name = prof.name ?? ctx.evidence.profile.display_name;
      ctx.evidence.profile.bio = prof.bio ?? ctx.evidence.profile.bio;
      ctx.evidence.profile.followers = fmtFollowers(prof.followers);
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
      ctx.emit({ phase: "P0 \xB7 Intake", label: dormant ? "Dormant account" : "Active", detail: dormant ? `No posts in ${days} days \u2014 a project or account gone quiet is a liveness flag.` : `Last posted ${days === 0 ? "today" : days === 1 ? "yesterday" : days + " days ago"}.`, source: "twitterapi.io", tone: dormant ? "warn" : "good" });
    }
    if (!ctx.evidence.notableFollowers.length) {
      ctx.emit({ phase: "P0 \xB7 Intake", label: "Notable followers", detail: "Checking which top funds, founders, and KOLs follow the subject\u2026", source: "twitterapi.io", tone: "neutral" });
      const fcm = (ctx.evidence.profile.followers ?? "").match(/([\d.]+)\s*([KMB]?)/i);
      const followerCount = fcm ? Number(fcm[1]) * (/m/i.test(fcm[2]) ? 1e6 : /b/i.test(fcm[2]) ? 1e9 : /k/i.test(fcm[2]) ? 1e3 : 1) : void 0;
      const scan = await notableFollowers(ctx.handle, { followerCount });
      const nf = scan.list;
      ctx.evidence.notableFollowers = nf;
      if (nf.length) {
        ctx.emit({ phase: "P0 \xB7 Intake", label: "Notable followers", detail: `Followed by ${nf.length} of ${scan.checked} known accounts checked: ${nf.slice(0, 8).map((n) => `@${n.handle}${n.label ? ` (${n.label})` : ""}`).join(", ")}${nf.length > 8 ? ", \u2026" : ""}.`, source: "twitterapi.io", tone: "good" });
      } else {
        ctx.emit({ phase: "P0 \xB7 Intake", label: "Notable followers", detail: `None of the ${scan.checked} known funds/founders/KOLs checked follow this subject.`, source: "twitterapi.io", tone: "neutral" });
      }
    }
    const claims = [...ctx.evidence.testimonials, ...ctx.evidence.advised].filter((t) => t.claimed_endorser_handle || t.project_handle).slice(0, 6);
    const ackMap = await acknowledgments(claims.map((t) => t.claimed_endorser_handle || t.project_handle), ctx.handle);
    await Promise.all(
      claims.map(async (t) => {
        const endorser = t.claimed_endorser_handle || t.project_handle;
        const follows = await followsSubject(endorser, ctx.handle);
        const ack = ackMap.get(String(endorser).replace(/^@/, "").toLowerCase()) ?? null;
        if (follows !== null) t.follows_subject = follows;
        if (ack) {
          t.public_acknowledgment = ack.ack;
          t.sentiment = ack.sentiment;
          t.relationship_corroborated = ack.ack === "endorsement" || ack.ack === "thanks";
          t.fud_present = ack.sentiment === "negative";
        }
        t.corroboration_verdict = classifyTestimonial(t);
        const tone = t.corroboration_verdict === "Contradicted" /* CONTRADICTED */ ? "bad" : t.corroboration_verdict === "Corroborated" /* CORROBORATED */ ? "good" : "warn";
        ctx.emit({ phase: "Corroborate", label: `${endorser}`, detail: `${t.claimed_relationship ?? "endorser"}: ${t.corroboration_verdict}${follows === false ? " \xB7 does not follow subject" : ""}`, source: "X", tone });
      })
    );
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
function htmlToText(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
}
async function fetchPage(url) {
  try {
    recordCall("site-fetch", "team-page", 0);
    const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; ARGUS/1.0)", accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(8e3) });
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") ?? "";
    if (!/html|markdown|text\/plain/i.test(ct)) return null;
    const raw = await r.text();
    const text = /markdown|text\/plain/i.test(ct) || url.endsWith(".md") ? raw.replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\s+/g, " ").trim() : htmlToText(raw);
    if (text.length < 300 || !/founder|ceo|cto|team|advisor|lead|head of|engineer|officer/i.test(text)) return null;
    return { url, text };
  } catch {
    return null;
  }
}
async function fetchTeamPage(domain, projectName) {
  const urls = candidateUrls(domain);
  if (!urls.length) return [];
  const pages = (await Promise.all(urls.map(fetchPage))).filter(Boolean);
  if (!pages.length) return [];
  pages.sort((a, b) => (/team/i.test(b.url) ? 1 : 0) - (/team/i.test(a.url) ? 1 : 0) || b.text.length - a.text.length);
  const corpus = pages.slice(0, 2).map((p) => `PAGE ${p.url}:
${p.text.slice(0, 6e3)}`).join("\n\n");
  const system = "You extract a crypto/tech project's team roster from the text of its own team/about page. List EVERY named person with a role: founders, executives (CEO/CTO/COO/CFO/CMO), core team, engineering/product leads, and named advisors. Use the exact role the page states. Capture any X/Twitter handle and LinkedIn URL shown next to a person. Do NOT invent people or roles; include only names actually present in the text. Never use em dashes.";
  const tool = {
    name: "record_team",
    description: "Record the named people listed on the project's team/about page.",
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
              linkedin: { type: "string", description: "linkedin.com/in/... if shown" }
            },
            required: ["name", "role"]
          }
        }
      },
      required: ["people"]
    }
  };
  const out = await structured(
    system,
    `Project${projectName ? ` ${projectName}` : ""} team page text:

${corpus}`,
    tool,
    2048
  );
  if (!out?.people?.length) return [];
  return out.people.filter((p) => p.name && p.name.trim()).map((p) => {
    const role = (p.role || "team").toString();
    const kind = /advisor|advis|backer|mentor/i.test(role) ? "advisor" : "team";
    const handle = p.twitter && /^@?[A-Za-z0-9_]{2,30}$/.test(p.twitter.replace(/^@/, "")) ? "@" + p.twitter.replace(/^@/, "") : void 0;
    const linkedin = p.linkedin && /linkedin\.com\/(in|company)\//i.test(p.linkedin) ? p.linkedin.replace(/^https?:\/\//, "").replace(/\/$/, "") : void 0;
    return { name: p.name.trim(), handle, role, kind, linkedin, evidence: "listed on the project's own team page", source: "team page" };
  });
}

// server/adapters/peopledatalabs.ts
var BASE = "https://api.peopledatalabs.com/v5";
async function enrichPerson(params) {
  const key = env("PDL_API_KEY");
  if (!key) return null;
  const qs = new URLSearchParams();
  if (params.profile) qs.set("profile", params.profile);
  if (params.name) qs.set("name", params.name);
  if (params.company) qs.set("company", params.company);
  qs.set("min_likelihood", params.company || params.profile ? "4" : "8");
  try {
    const res = await fetch(`${BASE}/person/enrich?${qs}`, { headers: { "X-Api-Key": key } });
    if (!res.ok) {
      recordPdlMatch(false);
      return null;
    }
    const d = await res.json();
    const p = d.data;
    recordPdlMatch(!!p);
    if (!p) return null;
    return {
      fullName: p.full_name,
      jobTitle: p.job_title,
      jobCompany: p.job_company_name,
      experience: (p.experience ?? []).map((x) => ({
        company: x.company?.name,
        title: x.title?.name,
        start: x.start_date,
        end: x.end_date,
        url: x.company?.website || x.company?.linkedin_url || null
      })),
      linkedin: p.linkedin_url,
      // Emails are the strongest cross-source bridge key: a PDL-resolved email that
      // MATCHES a leaked GitHub commit email proves the anon dev is this named person.
      emails: [...new Set([
        p.work_email,
        ...Array.isArray(p.personal_emails) ? p.personal_emails : [],
        ...Array.isArray(p.emails) ? p.emails.map((e) => typeof e === "string" ? e : e?.address) : []
      ].filter((e) => typeof e === "string" && e.includes("@")).map((e) => e.toLowerCase()))],
      github: typeof p.github_username === "string" ? p.github_username : null,
      location: typeof p.location_name === "string" ? p.location_name : null
    };
  } catch {
    return null;
  }
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
      ctx.emit({ phase: "P1 \xB7 Identity", label: "No match", detail: "No real-world identity record matched; scored as pseudonymous (no penalty).", source: "peopledatalabs", tone: "neutral" });
      return;
    }
    ctx.evidence.profile.identity_confidence = person.linkedin ? "Probable" : ctx.evidence.profile.identity_confidence;
    if (person.emails.length) ctx.evidence.profile.identity_emails = person.emails;
    const emailNote = person.emails.length ? ` Email on record: ${person.emails[0]}.` : "";
    ctx.evidence.profile.identity_note = `Resolved to ${person.fullName}, ${person.jobTitle ?? "role unknown"} @ ${person.jobCompany ?? "n/a"}. ${person.experience.length} roles on record${person.linkedin ? ` (${person.linkedin})` : ""}.${emailNote}`;
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
        confirmed.push(company);
      } else {
        const rec = {
          project_name: company,
          role: title,
          period,
          outcome: "Unknown" /* UNKNOWN */,
          evidence_url: httpify(x.url),
          notes: "People Data Labs employment record"
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
async function ghJson(path, key) {
  try {
    recordCall("github", path.split("?")[0].split("/").slice(1, 3).join("/") || "api", 0);
    const res = await fetch(GH + path, { headers: headers2(key), signal: AbortSignal.timeout(8e3) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
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
      ctx.emit({ phase: "P1 \xB7 Identity", label: "No GitHub match", detail: "No GitHub account links back to this X handle.", source: "github", tone: "neutral" });
      return;
    }
    if (match.confidence === "weak") {
      ctx.emit({ phase: "P1 \xB7 Identity", label: "Possible GitHub", detail: `github.com/${match.login} shares the handle but does not link back to X. Unconfirmed, not attributed.`, source: "github", tone: "warn" });
      return;
    }
    ctx.evidence.profile.identity_confidence = "Probable";
    ctx.evidence.profile.identity_note = `GitHub github.com/${match.login}${match.name ? ` (${match.name})` : ""} links back to this X handle.`;
    ctx.emit({ phase: "P1 \xB7 Identity", label: "GitHub confirmed", detail: `github.com/${match.login} links back to ${ctx.handle} (twitter_username match).`, source: "github", tone: "good" });
    const affs = await githubAffiliations(match.login, key);
    if (!affs.length) {
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
        notes: `GitHub: ${a.via}`
      });
      ctx.evidence.associates.push({ associate_handle: a.org, relation: "github org", evidence_url: `https://github.com/${a.org}` });
      added.push(a.org);
    }
    ctx.emit({ phase: "P1 \xB7 Identity", label: "GitHub affiliations", detail: `${added.length} org(s) this account builds with (near-permanent, hard to scrub): ${added.slice(0, 5).join(", ")}.`, source: "github", tone: "good" });
  }
};

// server/adapters/crunchbase.ts
var BASE2 = "https://api.crunchbase.com/api/v4";
async function lookupOrganization(name) {
  const key = env("CRUNCHBASE_API_KEY");
  if (!key) return null;
  try {
    recordCall("crunchbase", "org-search", 0, "plan-billed");
    const res = await fetch(`${BASE2}/searches/organizations`, {
      method: "POST",
      headers: { "X-cb-user-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        field_ids: ["identifier", "funding_total", "num_funding_rounds", "investor_identifiers", "acquirer_identifier"],
        query: [{ type: "predicate", field_id: "identifier", operator_id: "contains", values: [name] }],
        limit: 1
      })
    });
    if (!res.ok) return null;
    const d = await res.json();
    const e = d.entities?.[0]?.properties;
    if (!e) return null;
    return {
      name: e.identifier?.value,
      fundingTotal: e.funding_total?.value_usd,
      rounds: e.num_funding_rounds,
      investors: (e.investor_identifiers ?? []).map((i) => i.value),
      acquirer: e.acquirer_identifier?.value
    };
  } catch {
    return null;
  }
}
var crunchbaseAdapter = {
  id: "crunchbase",
  label: "Crunchbase",
  available: () => !!env("CRUNCHBASE_API_KEY"),
  async run(ctx) {
    if (!ctx.evidence.ventures.length) return;
    ctx.emit({ phase: "Founder", label: "Verify funding", detail: `Cross-referencing ${ctx.evidence.ventures.length} venture(s) against Crunchbase\u2026`, tone: "neutral" });
    for (const v of ctx.evidence.ventures) {
      const org = await lookupOrganization(v.project_name);
      if (!org) {
        ctx.emit({ phase: "Founder", label: v.project_name, detail: "no Crunchbase record found for claimed venture", source: "crunchbase", tone: "warn" });
        continue;
      }
      if (org.investors?.length) v.investors = Array.from(/* @__PURE__ */ new Set([...v.investors ?? [], ...org.investors]));
      if (org.acquirer && !v.acquirer) v.acquirer = org.acquirer;
      ctx.emit({ phase: "Founder", label: v.project_name, detail: `verified \xB7 ${org.rounds ?? 0} rounds, backers: ${(org.investors ?? []).slice(0, 3).join(", ") || "n/a"}`, source: "crunchbase", tone: "good" });
    }
  }
};

// server/adapters/dexscreener.ts
var BASE3 = "https://api.dexscreener.com";
async function lookupToken(address) {
  try {
    recordCall("dexscreener", "token-pairs", 0);
    const res = await fetch(`${BASE3}/latest/dex/tokens/${address}`);
    if (!res.ok) return null;
    const data = await res.json();
    const pairs = data.pairs ?? [];
    if (!pairs.length) return { address };
    const top = pairs.reduce((a, b) => (b.liquidity?.usd ?? 0) > (a.liquidity?.usd ?? 0) ? b : a);
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
  } catch {
    return null;
  }
}
var dexscreenerAdapter = {
  id: "dexscreener",
  label: "DexScreener",
  available: () => true,
  // keyless
  async run(ctx) {
    const promos = ctx.evidence.promotions.filter((p) => p.contract_address);
    if (!promos.length) return;
    ctx.emit({ phase: "On-chain", label: "DEX liquidity scan", detail: `Resolving ${promos.length} promoted token(s) on DexScreener\u2026`, tone: "neutral" });
    for (const p of promos) {
      const snap = await lookupToken(p.contract_address);
      if (!snap) continue;
      const thin = (snap.liquidityUsd ?? 0) < 1e4;
      p.perf_current = snap.priceUsd;
      ctx.emit({
        phase: "On-chain",
        label: `$${snap.symbol ?? p.ticker}`,
        detail: `liquidity $${Math.round(snap.liquidityUsd ?? 0).toLocaleString()}, 24h vol $${Math.round(snap.volume24h ?? 0).toLocaleString()}${thin ? " \u2014 thin liquidity, rug-risk flag" : ""}`,
        source: "dexscreener",
        tone: thin ? "warn" : "neutral"
      });
    }
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
  const headers3 = key ? { "x-cg-pro-api-key": key } : {};
  try {
    recordCall("coingecko", "contract-lookup", 0);
    const res = await fetch(`${base}/coins/${platform}/contract/${address}`, { headers: headers3 });
    if (!res.ok) return null;
    const d = await res.json();
    return {
      symbol: d.symbol,
      name: d.name,
      priceUsd: d.market_data?.current_price?.usd,
      mcapUsd: d.market_data?.market_cap?.usd,
      ath_change_pct: d.market_data?.ath_change_percentage?.usd
    };
  } catch {
    return null;
  }
}
var coingeckoAdapter = {
  id: "coingecko",
  label: "CoinGecko",
  available: () => true,
  // public endpoint works without key (rate limited)
  async run(ctx) {
    const promos = ctx.evidence.promotions.filter((p) => p.contract_address && p.chain);
    if (!promos.length) return;
    ctx.emit({ phase: "On-chain", label: "Market data", detail: "Cross-referencing promoted tokens against CoinGecko (source of record)\u2026", tone: "neutral" });
    for (const p of promos) {
      const t = await tokenByContract(p.chain, p.contract_address);
      if (!t) continue;
      const downBad = (t.ath_change_pct ?? 0) < -90;
      ctx.emit({
        phase: "On-chain",
        label: `$${t.symbol?.toUpperCase() ?? p.ticker}`,
        detail: `mcap $${Math.round(t.mcapUsd ?? 0).toLocaleString()}${downBad ? `, ${Math.round(t.ath_change_pct)}% from ATH \u2014 collapsed` : ""}`,
        source: "coingecko",
        tone: downBad ? "warn" : "neutral"
      });
    }
  }
};

// server/adapters/reddit.ts
var cachedToken = null;
async function getToken() {
  const id = env("REDDIT_CLIENT_ID");
  const secret = env("REDDIT_CLIENT_SECRET");
  if (!id || !secret) return null;
  if (cachedToken && cachedToken.exp > Date.now()) return cachedToken.token;
  try {
    const res = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": "argus-dd/1.0"
      },
      body: "grant_type=client_credentials"
    });
    if (!res.ok) return null;
    const d = await res.json();
    cachedToken = { token: d.access_token, exp: Date.now() + (d.expires_in - 60) * 1e3 };
    return cachedToken.token;
  } catch {
    return null;
  }
}
async function searchMentions(query) {
  const token = await getToken();
  if (!token) return [];
  try {
    recordCall("reddit", "search", 0);
    const res = await fetch(`https://oauth.reddit.com/search?q=${encodeURIComponent(query)}&sort=relevance&limit=15&t=year`, {
      headers: { authorization: `Bearer ${token}`, "user-agent": "argus-dd/1.0" }
    });
    if (!res.ok) return [];
    const d = await res.json();
    return (d.data?.children ?? []).map((c) => ({
      title: c.data.title,
      sub: c.data.subreddit_name_prefixed,
      score: c.data.score,
      url: "https://reddit.com" + c.data.permalink
    }));
  } catch {
    return [];
  }
}
var redditAdapter = {
  id: "reddit",
  label: "Reddit",
  available: () => !!env("REDDIT_CLIENT_ID") && !!env("REDDIT_CLIENT_SECRET"),
  async run(ctx) {
    const handle = ctx.handle.replace(/^@/, "");
    ctx.emit({ phase: "Reputation", label: "FUD scan", detail: `Searching Reddit for "${handle}" mentions\u2026`, tone: "neutral" });
    const hits = await searchMentions(`${handle} (scam OR rug OR warning OR review)`);
    if (!hits.length) {
      ctx.emit({ phase: "Reputation", label: "No FUD surfaced", detail: "No notable Reddit complaints in the last year.", source: "reddit", tone: "neutral" });
      return;
    }
    for (const h of hits.slice(0, 5)) {
      ctx.evidence.findings.push({
        finding_type: "CommunityFUD",
        claim: h.title,
        source_url: h.url,
        source_date: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
        verification_status: "Reported",
        independent_source_count: 1,
        polarity: -1
      });
    }
    ctx.emit({ phase: "Reputation", label: `${hits.length} threads`, detail: `Top: "${hits[0].title.slice(0, 70)}" (${hits[0].sub})`, source: "reddit", tone: hits.length > 3 ? "warn" : "neutral" });
  }
};

// server/adapters/onchain.ts
async function heliusWalletActivity(address) {
  const key = env("HELIUS_API_KEY");
  if (!key) return null;
  try {
    recordHelius("address-transactions");
    const res = await fetch(`https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${key}&limit=50`);
    if (!res.ok) return null;
    const txs = await res.json();
    return { count: txs.length, latest: txs[0]?.timestamp };
  } catch {
    return null;
  }
}
var onchainAdapter = {
  id: "onchain",
  label: "On-chain forensics (Helius / Bitquery)",
  available: () => !!env("HELIUS_API_KEY") || !!env("BITQUERY_API_KEY"),
  async run(ctx) {
    const wallets = ctx.evidence.wallets.filter(
      (w) => w.link_tier === "SelfDoxxed" || w.link_tier === "InvestigatorAttributed"
    );
    if (!wallets.length) return;
    ctx.emit({ phase: "On-chain", label: "Wallet forensics", detail: `Examining ${wallets.length} attributed wallet(s)\u2026`, tone: "neutral" });
    for (const w of wallets) {
      if (w.chain === "solana" && env("HELIUS_API_KEY")) {
        const act = await heliusWalletActivity(w.address);
        if (act) {
          w.activity_summary = `${act.count} recent txs`;
          ctx.emit({ phase: "On-chain", label: `${w.address.slice(0, 6)}\u2026`, detail: `${act.count} recent transactions`, source: "helius", tone: w.sold_into_own_promo ? "bad" : "neutral" });
        }
      } else if (w.sold_into_own_promo) {
        ctx.emit({ phase: "On-chain", label: `${w.address.slice(0, 6)}\u2026`, detail: "attributed wallet sold into own promotion (cap)", source: "bitquery", tone: "bad" });
      }
    }
  }
};

// server/adapters/wayback.ts
var CDX = "https://web.archive.org/cdx/search/cdx";
async function newestSnapshot(urlPath) {
  try {
    const qs = `?url=${encodeURIComponent(urlPath)}&output=json&filter=statuscode:200&collapse=digest&limit=-1`;
    recordCall("wayback", "cdx-search", 0);
    const res = await fetch(CDX + qs, { signal: AbortSignal.timeout(4e3) });
    if (!res.ok) return null;
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length < 2) return null;
    const last = rows[rows.length - 1];
    const ti = rows[0].indexOf("timestamp");
    const oi = rows[0].indexOf("original");
    if (ti < 0 || oi < 0) return null;
    return { timestamp: last[ti], original: last[oi] };
  } catch {
    return null;
  }
}
async function archivedAffiliation(domain, name) {
  const clean = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
  if (!clean || !name) return null;
  const needles = nameNeedles(name);
  if (!needles.length) return null;
  const paths = [`${clean}/team`, `${clean}/about`, clean];
  for (const p of paths) {
    const snap = await newestSnapshot(p);
    if (!snap) continue;
    try {
      const archiveUrl = `https://web.archive.org/web/${snap.timestamp}id_/${snap.original}`;
      recordCall("wayback", "snapshot-fetch", 0);
      const res = await fetch(archiveUrl, { signal: AbortSignal.timeout(5e3) });
      if (!res.ok) continue;
      const text = (await res.text()).toLowerCase();
      if (needles.some((n) => text.includes(n))) {
        return {
          url: `https://web.archive.org/web/${snap.timestamp}/${snap.original}`,
          year: snap.timestamp.slice(0, 4),
          where: p.replace(clean, "").replace(/^\//, "") || "homepage"
        };
      }
    } catch {
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
  try {
    recordCall("wallet-resolve", new URL(url).host, 0);
    const r = await fetch(url, { signal: AbortSignal.timeout(9e3) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
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
async function resolveWalletsFromText(text) {
  if (!text) return [];
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (address, chain, source) => {
    if (!address) return;
    const k = address.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ address, chain, source, tier: "SelfDoxxed" });
  };
  for (const m of text.matchAll(ADDR_IN_TEXT)) add(m[0], "evm", "0x address self-disclosed in X bio/posts");
  const names = /* @__PURE__ */ new Set();
  for (const m of text.matchAll(NAME_IN_TEXT)) names.add(m[0].toLowerCase());
  for (const nm of [...names].slice(0, 6)) {
    const r = await resolveName(nm);
    add(r?.address ?? null, r?.chain ?? "evm", `${nm} (self-disclosed in X bio/posts)`);
  }
  return out.slice(0, 6);
}
async function resolveForHandle(handle, text, opts = {}) {
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
  const [fromText, fromFc] = await Promise.all([resolveWalletsFromText(text), farcasterWallets(handle)]);
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

// server/orchestrate.ts
var ADAPTERS = [
  xAdapter,
  githubAdapter,
  peopledatalabsAdapter,
  crunchbaseAdapter,
  dexscreenerAdapter,
  coingeckoAdapter,
  redditAdapter,
  onchainAdapter
];
var KEYED = /* @__PURE__ */ new Set(["x", "github", "peopledatalabs", "crunchbase", "reddit", "onchain"]);
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
async function coldIntake(ctx) {
  let siteUrl;
  const prof = await getProfile2(ctx.handle);
  if (prof) {
    ctx.evidence.profile.display_name = prof.name ?? ctx.evidence.profile.display_name;
    if (prof.image) ctx.evidence.profile.avatar_url = prof.image;
    ctx.evidence.profile.bio = prof.bio ?? "";
    siteUrl = prof.website;
    if (prof.followers != null) ctx.evidence.profile.followers = fmtFollowers(prof.followers);
    if (prof.createdAt) {
      const d = new Date(prof.createdAt);
      if (!isNaN(d.getTime())) ctx.evidence.profile.joined = d.toLocaleString("en-US", { month: "short", year: "numeric" });
    }
    ctx.emit({ phase: "P0 \xB7 Intake", label: "Resolve profile", detail: `${prof.name ?? ctx.handle} \xB7 ${ctx.evidence.profile.followers} followers \xB7 joined ${ctx.evidence.profile.joined}`, source: "twitterapi.io", tone: "neutral" });
  } else {
    ctx.emit({ phase: "P0 \xB7 Intake", label: "Profile unavailable", detail: "twitterapi.io has no record of this handle (not in their index). Continuing with web/X discovery.", source: "twitterapi.io", tone: "warn" });
  }
  const hist = await handleHistory(ctx.handle);
  if (hist && hist.priorHandles.length) {
    ctx.evidence.profile.prior_handles = hist.priorHandles;
    ctx.emit({ phase: "P0 \xB7 Intake", label: "Handle history", detail: `This account previously went by ${hist.priorHandles.map((p) => "@" + p).join(", ")} \u2014 a rebrand. Old posts and mentions are searched too.`, source: "memory.lol", tone: "warn" });
  } else if (hist) {
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
  if (!analystAvailable()) return;
  ctx.emit({ phase: "P0 \xB7 Intake", label: "Extract claims", detail: "Reading the subject's bio and posts for self-claims to verify\u2026", tone: "neutral" });
  const claims = await extractClaims(ctx.handle, ctx.evidence.profile.bio, posts);
  if (claims) {
    ctx.evidence.roles = asRoles(claims.roles);
    ctx.evidence.ventures = claims.ventures.map((v) => ({
      project_name: v.project_name,
      role: v.role ?? "founder",
      period: v.period ?? "",
      outcome: parseOutcome(v.claimed_outcome)
    }));
    ctx.evidence.testimonials = claims.testimonials.map((t) => ({
      claimed_endorser_handle: t.claimed_endorser_handle,
      claimed_relationship: t.claimed_relationship,
      appears_at: "subject surfaces"
    }));
    ctx.evidence.advised = claims.advised.map((p) => ({
      project_name: p.project_name,
      project_handle: p.project_handle,
      claimed_role: p.claimed_role ?? "advisor",
      appears_at: "subject surfaces"
    }));
    ctx.evidence.promotions = claims.promotions.map((p) => ({
      ticker: p.ticker,
      contract_address: p.contract_address,
      chain: p.chain
    }));
    const n = claims.ventures.length + claims.testimonials.length + claims.advised.length + claims.promotions.length;
    ctx.emit({ phase: "P0 \xB7 Intake", label: "Claims extracted", detail: `${n} self-claims across ${ctx.evidence.roles.join(", ") || "no roles"} \u2014 now verifying each.`, source: "claude", tone: "neutral" });
  }
  ctx.emit({ phase: "P0 \xB7 Intake", label: "Discover affiliations", detail: "Three angles in parallel: what this account is tied to, who has named them, and the team named in their own X posts\u2026", source: "grok", tone: "neutral" });
  const bioDomain = ctx.evidence.profile.bio.match(/\b([a-z0-9-]+\.(?:xyz|io|com|fi|net|finance|app|org|co|gg|network|dev|ai|so|money))\b/i)?.[1];
  const domain = (siteUrl ?? (bioDomain ? `https://${bioDomain}` : "")).replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const teamDomain = domain || `${ctx.handle.replace(/^@/, "").toLowerCase()}.com`;
  const [bySubject, people, siteTeam, pageTeam] = await Promise.all([
    discoverAffiliations(ctx.handle, ctx.evidence.profile.display_name, ctx.evidence.profile.prior_handles ?? []),
    findTeam(ctx.handle, ctx.evidence.profile.display_name, ctx.evidence.recentActivity),
    // Run the deeper web/LinkedIn/press team search whenever we have EITHER a
    // domain or a project name — a big public project's roster lives off-X, and
    // many project accounts (e.g. @VulcanForged) put no plain domain in the bio.
    domain || ctx.evidence.profile.display_name ? findTeamOnSite(domain, ctx.evidence.profile.display_name) : Promise.resolve([]),
    // Read the project's own /team page directly (Grok's summary can miss it).
    fetchTeamPage(teamDomain, ctx.evidence.profile.display_name)
  ]);
  const postRoleTeam = scanPostsForRoles(ctx.evidence.recentActivity);
  const webTeam = ctx.evidence.webTeam ?? (ctx.evidence.webTeam = []);
  const norm2 = (s) => (s ?? "").trim().toLowerCase().replace(/^@/, "");
  const byHandle = /* @__PURE__ */ new Map();
  const byName = /* @__PURE__ */ new Map();
  for (const t of [...pageTeam, ...siteTeam, ...people, ...postRoleTeam]) {
    const h = t.handle ? norm2(t.handle) : "";
    const n = norm2(t.name);
    if (!h && !n) continue;
    const existing = h && byHandle.get(h) || n && byName.get(n) || null;
    if (existing) {
      if (!existing.handle && t.handle) {
        existing.handle = t.handle;
        byHandle.set(norm2(t.handle), existing);
      }
      if (!existing.linkedin && t.linkedin) existing.linkedin = t.linkedin;
      if ((!existing.projects || !existing.projects.length) && t.projects?.length) existing.projects = t.projects;
      continue;
    }
    const rec = { name: t.name, handle: t.handle, role: t.role, linkedin: t.linkedin, evidence: t.evidence, source: t.source ?? "X content", projects: t.projects };
    webTeam.push(rec);
    if (h) byHandle.set(h, rec);
    if (n) byName.set(n, rec);
  }
  const subj = norm2(ctx.handle);
  const accountVouchesTeam = !!domain || people.length > 0 || postRoleTeam.length > 0 || webTeam.some((t) => norm2(t.handle) === subj);
  if (webTeam.length && !accountVouchesTeam) {
    ctx.emit({ phase: "P1 \xB7 Team", label: "Same-name project (not this account)", detail: `Found a team for the name "${ctx.evidence.profile.display_name || ctx.handle}", but nothing ties THIS account to it \u2014 its handle isn't among them, it links no site, and its own posts name no team. Treated as a name collision, not the account's identity.`, source: "team-search", tone: "warn" });
    webTeam.length = 0;
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
        linked++;
      }
      if (!m.linkedin && f.linkedin) {
        m.linkedin = f.linkedin;
        if (!f.handle) linked++;
      }
    }
    if (linked) ctx.emit({ phase: "P1 \xB7 Team", label: "Identities linked", detail: `Resolved X/LinkedIn for ${linked} of ${nameOnly.length} name-only team members.`, source: "grok", tone: "good" });
  }
  if (webTeam.length) {
    ctx.emit({ phase: "P1 \xB7 Team", label: "Team assembled", detail: `${webTeam.length} people behind the project: ${webTeam.slice(0, 6).map((t) => t.name + (t.handle ? ` ${t.handle}` : "")).join(", ")}${domain ? ` (site + posts)` : " (posts)"}.`, source: "team-search", tone: "good" });
    const isLeader = (r) => /founder|cofounder|co-founder|ceo|cto|coo|president|chief/i.test(r ?? "");
    const leaders = webTeam.filter((t) => isLeader(t.role));
    const leaderWithLinkedin = leaders.some((t) => !!t.linkedin);
    const rank = { Unverified: 0, Probable: 1, Confirmed: 2 };
    const cur = ctx.evidence.profile.identity_confidence;
    if (cur !== "SuspectedImpersonation") {
      const target = leaderWithLinkedin ? "Confirmed" : leaders.length || webTeam.length >= 2 ? "Probable" : null;
      if (target && (rank[target] ?? 0) > (rank[cur ?? "Unverified"] ?? 0)) {
        ctx.evidence.profile.identity_confidence = target;
        ctx.emit({ phase: "P1 \xB7 Team", label: `Identity ${target.toLowerCase()}`, detail: `Project identity resolved through its named team${leaderWithLinkedin ? " (LinkedIn-corroborated leadership)" : ""}; a brand handle over a public team is not an anonymity flag.`, source: "team-search", tone: "good" });
      }
    }
  } else if (domain) {
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
      ctx.evidence.associates.push({ associate_handle: t.handle, relation: `team: ${t.role}`, notes: t.evidence });
      addedTeam.push(`${t.name} (${t.handle})`);
    }
    const addedAdv = [];
    for (const a of advisorList) {
      if (!a.handle) continue;
      const key = a.handle.replace(/^@/, "").toLowerCase();
      if (haveTest.has(key)) continue;
      haveTest.add(key);
      ctx.evidence.testimonials.push({ claimed_endorser_handle: a.handle, claimed_relationship: "advisor", appears_at: "project X content" });
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
        role: v.role,
        period: v.year ?? "",
        outcome: "Active" /* ACTIVE */,
        evidence_url: null,
        notes: [v.evidence, "single-source lead, unverified"].filter(Boolean).join(" \xB7 ")
      };
      ctx.evidence.ventures.push(rec);
      return { v, rec };
    });
    const founderish = discovered.some((v) => /founder|cofounder/i.test(v.role));
    if (founderish && (!ctx.evidence.roles.length || ctx.evidence.roles.every((r) => r === "MEMBER" /* MEMBER */))) {
      ctx.evidence.roles = ["FOUNDER" /* FOUNDER */];
    }
    ctx.emit({ phase: "P0 \xB7 Intake", label: "Affiliations discovered", detail: `${discovered.length} public affiliation${discovered.length === 1 ? "" : "s"} tied to the subject: ${discovered.slice(0, 5).map((v) => v.name).join(", ")}.`, source: "grok", tone: "good" });
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
          rec.notes = [v.evidence, `corroborated: ${corrob.join("; ")}`].filter(Boolean).join(" \xB7 ");
          ctx.emit({ phase: "P0 \xB7 Intake", label: `Affiliation corroborated \xB7 ${v.name}`, detail: `${v.role}${v.year ? `, ${v.year}` : ""} \u2014 ${corrob.join("; ")}.`, source: "argus", tone: "good" });
        }
      })
    );
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
async function runAudit(rawHandle, emit) {
  resetCost();
  const fixture = findSubject(rawHandle);
  const liveProviders = ADAPTERS.filter((a) => KEYED.has(a.id) && a.available());
  const anyLive = liveProviders.length > 0 || analystAvailable();
  if (fixture && !anyLive) {
    for (const step of fixture.trace) {
      emit(step);
      await delay(420 + Math.random() * 360);
    }
    await delay(500);
    return assembleDossier(toEvidence(fixture), false);
  }
  const evidence = fixture ? toEvidence(fixture) : emptyEvidence(rawHandle);
  emit({ phase: "P0 \xB7 Intake", label: "Resolve handle", detail: `Normalizing ${rawHandle} and opening the audit ledger.`, tone: "neutral" });
  const ctx = { handle: evidence.profile.handle, evidence, emit };
  if (!fixture) await coldIntake(ctx);
  for (const a of ADAPTERS) {
    if (!a.available()) continue;
    try {
      await a.run(ctx);
    } catch (e) {
      emit({ phase: "Collect", label: `${a.label} error`, detail: String(e), tone: "warn" });
    }
  }
  if (!evidence.roles.length) {
    const route = classifySubject(evidence.profile.bio);
    evidence.roles = route.applicable_classes.length ? route.applicable_classes : ["MEMBER" /* MEMBER */];
    emit({ phase: "P0 \xB7 Routing", label: "Classify roles", detail: `Routed to ${evidence.roles.join(", ")} (${route.confidence} confidence).`, tone: "neutral" });
  }
  const { identity_confidence: _ic, identity_note: _in, ...profileForLlm } = evidence.profile;
  const baseEvidence = {
    profile: profileForLlm,
    ventures: evidence.ventures,
    testimonials: evidence.testimonials,
    advised: evidence.advised,
    promotions: evidence.promotions,
    wallets: evidence.wallets,
    // The named people behind the project (from the site + LinkedIn + X content),
    // so identity/founder scoring reflects the team we actually found.
    team: (evidence.webTeam ?? []).map((p) => ({ name: p.name, handle: p.handle, role: p.role, linkedin: p.linkedin, otherProjects: p.projects })),
    findings: evidence.findings,
    notableFollowers: evidence.notableFollowers,
    recentActivity: evidence.recentActivity.slice(0, 12)
  };
  if (analystAvailable()) {
    emit({ phase: "Contradictions", label: "Scan materials", detail: "Cross-referencing every claim against the collected evidence for internal contradictions\u2026", tone: "neutral" });
    emit({ phase: "Analyst", label: "Score axes", detail: "Claude analyst scoring every axis from the collected evidence\u2026", tone: "neutral" });
    const evidenceJson = JSON.stringify(baseEvidence, null, 0).slice(0, 12e3);
    const [found, verdict] = await Promise.all([
      scanContradictions(evidence.profile.handle, evidenceJson),
      analyzeSubject(evidence.profile.handle, evidence.roles, axisCatalog(evidence.roles), evidenceJson)
    ]);
    if (found && found.length) {
      evidence.contradictions = found;
      const worst = found.some((c) => c.severity === "high") ? "bad" : "warn";
      emit({ phase: "Contradictions", label: `${found.length} contradiction${found.length === 1 ? "" : "s"}`, detail: found.slice(0, 3).map((c) => `${c.claim} vs ${c.conflict}`).join(" \xB7 "), source: "claude", tone: worst });
    } else {
      emit({ phase: "Contradictions", label: "None found", detail: "No internal contradictions surfaced across the subject's claims and the evidence.", source: "claude", tone: "good" });
    }
    if (verdict) {
      evidence.axes = verdict.axes;
      evidence.headline = verdict.headline || evidence.headline;
      if (verdict.identity_note) evidence.profile.identity_note = verdict.identity_note;
      emit({ phase: "Analyst", label: "Scored", detail: `${verdict.axes.length} axes scored.`, source: "claude", tone: "good" });
    } else {
      emit({ phase: "Analyst", label: "Fell back", detail: "Analyst unavailable; using seeded axis scores.", tone: "warn" });
    }
  }
  if (!evidence.axes.length && !fixture) {
    emit({ phase: "Finalize", label: "Incomplete", detail: "Not enough evidence to score this subject.", tone: "warn" });
    return null;
  }
  emit({ phase: "Finalize", label: "Govern composite", detail: "Applying caps and selecting the governing role.", tone: "neutral" });
  await delay(300);
  const dossier = assembleDossier(evidence, true);
  const cost = getCost();
  dossier.cost = cost;
  emit({ phase: "Finalize", label: "Audit cost", detail: `~$${cost.usd.toFixed(2)} this audit (Grok $${cost.grokUsd.toFixed(2)} across ${cost.grokCalls} searches \u2248${cost.sources} sources \xB7 Claude $${cost.claudeUsd.toFixed(2)} across ${cost.claudeCalls} calls).`, tone: "neutral" });
  return dossier;
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
async function dexByToken(address) {
  const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
  if (!res.ok) return [];
  const d = await res.json();
  return d.pairs ?? [];
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
var CG_TIER1 = /binance|coinbase|kraken|okx|bybit|kucoin|gate|crypto\.?com|bitget|upbit|huobi|htx|mexc/i;
async function coingeckoToken(chain, address) {
  const plat = CG_PLATFORM[chain] ?? chain;
  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/coins/${plat}/contract/${address}?localization=false&tickers=true&market_data=true&community_data=false&developer_data=false`);
    if (res.status === 404) return { listed: false, rank: null, mcapUsd: null, marketCount: 0, cexCount: 0, cexNames: [], homepage: null, twitter: null, image: null };
    if (!res.ok) return null;
    const d = await res.json();
    const tickers = d.tickers ?? [];
    const markets = new Set(tickers.map((t) => t.market?.name).filter(Boolean));
    const cex = new Set(tickers.filter((t) => !CG_DEX.test(t.market?.identifier || t.market?.name || "")).map((t) => t.market?.name).filter(Boolean));
    const cexNames = [...cex].sort((a, b) => (CG_TIER1.test(b) ? 1 : 0) - (CG_TIER1.test(a) ? 1 : 0)).slice(0, 12);
    const homepage = (d.links?.homepage ?? []).find((u) => typeof u === "string" && /^https?:\/\//i.test(u)) ?? null;
    const tw = typeof d.links?.twitter_screen_name === "string" ? d.links.twitter_screen_name.replace(/^@/, "").trim() : "";
    const twitter = /^[A-Za-z0-9_]{2,30}$/.test(tw) ? tw : null;
    const image = d.image?.large ?? d.image?.small ?? d.image?.thumb ?? null;
    return { listed: true, rank: d.market_cap_rank ?? null, mcapUsd: d.market_data?.market_cap?.usd ?? null, marketCount: markets.size, cexCount: cex.size, cexNames, homepage, twitter, image };
  } catch {
    return null;
  }
}
async function dexByPair(chain, pair) {
  const res = await fetch(`https://api.dexscreener.com/latest/dex/pairs/${chain}/${pair}`);
  if (!res.ok) return null;
  const d = await res.json();
  return d.pair ?? d.pairs?.[0] ?? null;
}
function pickPair(pairs, wantAddress) {
  if (!pairs.length) return null;
  const byLiq = [...pairs].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  if (wantAddress) {
    const match = byLiq.find((p) => p.baseToken?.address?.toLowerCase() === wantAddress.toLowerCase());
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
      flags: (d.flags ?? []).map((f) => f.description ?? f.flag ?? String(f))
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
  const key = `${input.via}:${input.ref.toLowerCase()}:${opts?.skipSim ? 1 : 0}`;
  const hit = _cache.get(key);
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
        findings.push({ claim: `honeypot.is reported a failed sell simulation, but the GoPlus on-chain check and ${why} contradict it \u2014 treated as a simulation artifact, not a honeypot.`, tone: "warn", source: "argus" });
      } else {
        caps.push([10, "honeypot_confirmed"]);
        findings.push({ claim: s.nonTransferable ? "Non-transferable token: holders cannot move it." : "Honeypot: the contract blocks selling.", tone: "bad", source: s.honeypotOnchain ? "goplus" : "sim" });
      }
    }
    if (s.cannotSellAll) caps.push([15, "cannot_sell_all"]);
    if (s.mintable) {
      caps.push([35, "mint_authority_active"]);
      findings.push({ claim: "Mint authority active: supply can be inflated at will.", tone: "bad", source: chain === "solana" ? "goplus-sol" : "goplus" });
    }
    if (s.freezable) {
      caps.push([35, "freeze_authority_active"]);
      findings.push({ claim: "Freeze authority active: the team can freeze your tokens (you cannot sell).", tone: "bad", source: "goplus-sol" });
    }
    if (s.takeBack || s.hiddenOwner) {
      caps.push([35, "reclaimable_ownership"]);
      findings.push({ claim: s.hiddenOwner ? "Hidden owner detected." : "Ownership can be taken back after renouncement.", tone: "bad", source: "goplus" });
    }
    if (s.selfdestruct) findings.push({ claim: "Contract can self-destruct / be closed.", tone: "bad", source: "goplus" });
    if (s.serialScammerCreator) {
      caps.push([25, "serial_scammer_creator"]);
      findings.push({ claim: "The wallet that deployed this token has created honeypot tokens before \u2014 a serial scammer.", tone: "bad", source: "goplus" });
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
        findings.push({ claim: "Owner can modify holder balances directly \u2014 they can zero your wallet.", tone: "bad", source: "goplus" });
      }
    }
    if (s.proxy) findings.push({ claim: ownerActive ? "Upgradeable proxy with an active owner: the contract logic can be swapped out from under holders." : "Upgradeable proxy contract (logic is replaceable), though ownership is renounced.", tone: ownerActive ? "bad" : "warn", source: "goplus" });
    if (s.slippageModifiable && ownerActive) findings.push({ claim: "Tax is modifiable: a low tax now can be raised toward 100% after you buy.", tone: "bad", source: "goplus" });
    if (s.blacklist && ownerActive) findings.push({ claim: "Owner can blacklist addresses \u2014 your wallet can be blocked from selling.", tone: "warn", source: "goplus" });
    if (s.tradingCooldown && ownerActive) findings.push({ claim: "Trading cooldown is enforceable \u2014 sells can be delayed.", tone: "warn", source: "goplus" });
    if (s.externalCall) findings.push({ claim: "Contract makes external calls \u2014 behavior can change via an external dependency.", tone: "warn", source: "goplus" });
    if (s.creatorPercent >= 5) findings.push({ claim: `Creator still holds ~${s.creatorPercent.toFixed(0)}% of supply.`, tone: s.creatorPercent >= 15 ? "bad" : "warn", source: "goplus" });
    if (chain === "solana") {
      if (s.balanceMutable) {
        if (broadlyTraded) findings.push({ claim: "A balance-mutable authority exists, but broad market presence indicates it is not an active threat.", tone: "warn", source: "argus" });
        else {
          caps.push([20, "balance_mutable_authority"]);
          findings.push({ claim: "Balance-mutable authority is active \u2014 the controller can rewrite your token balance.", tone: "bad", source: "goplus-sol" });
        }
      }
      if (s.transferHook) findings.push({ claim: "Transfer hook active: an external program runs on every transfer and can block sells.", tone: "bad", source: "goplus-sol" });
      if (s.transferFee) findings.push({ claim: "A Token-2022 transfer fee is configured \u2014 a built-in tax on every transfer.", tone: "warn", source: "goplus-sol" });
    }
    if (s.lpBurnedPct >= 50) findings.push({ claim: `Liquidity is burned (~${s.lpBurnedPct.toFixed(0)}%) \u2014 permanently removed, it cannot be pulled.`, tone: "good", source: "goplus" });
    else if (s.lpLockedPct >= 50) findings.push({ claim: `Liquidity is locked (~${s.lpLockedPct.toFixed(0)}%).`, tone: "good", source: "goplus" });
    else if (s.lpTopUnlockedEoaPct >= 80) findings.push({ claim: `All liquidity (~${s.lpTopUnlockedEoaPct.toFixed(0)}%) sits in a single unlocked wallet \u2014 it can be pulled at any time.`, tone: "bad", source: "goplus" });
    else if (s.lpTopUnlockedEoaPct >= 50) findings.push({ claim: `Most liquidity (~${s.lpTopUnlockedEoaPct.toFixed(0)}%) is in one unlocked wallet \u2014 removable at will.`, tone: "warn", source: "goplus" });
    else findings.push({ claim: "Liquidity does not appear locked or burned.", tone: "warn", source: "goplus" });
  }
  if (liquidityUsd < 15e3) findings.push({ claim: `Thin liquidity ($${Math.round(liquidityUsd).toLocaleString()}). Easy to drain or move.`, tone: "warn", source: "dexscreener" });
  if (ageDays != null && ageDays < 7) findings.push({ claim: `Pair is ${ageDays < 1 ? "under a day" : Math.round(ageDays) + " days"} old.`, tone: "warn", source: "dexscreener" });
  if (washSignature) findings.push({ claim: `Volume is ${volLiq.toFixed(0)}x liquidity in 24h while the price moved only ${pc24.toFixed(1)}% \u2014 a wash-trading / fake-volume signature.`, tone: "bad", source: "dexscreener" });
  if (pc24 <= -60) findings.push({ claim: `Down ${Math.abs(pc24).toFixed(0)}% in 24h \u2014 the token appears to have already dumped.`, tone: "bad", source: "dexscreener" });
  else if (pc24 >= 300 && liquidityUsd < 1e5) findings.push({ claim: `Up ${pc24.toFixed(0)}% in 24h on thin liquidity \u2014 a vertical pump with high reversal risk.`, tone: "warn", source: "dexscreener" });
  if (!opts?.skipSim) {
    if (cg && !cg.listed) {
      findings.push({ claim: "Not listed on CoinGecko \u2014 no independent market-data corroboration.", tone: "warn", source: "coingecko" });
    } else if (cg) {
      findings.push({ claim: `Corroborated on CoinGecko${cg.rank ? ` (rank #${cg.rank})` : ""}, ${cg.cexCount} centralized market${cg.cexCount === 1 ? "" : "s"}.`, tone: "good", source: "coingecko" });
      if (cg.mcapUsd && fdv && fdv > cg.mcapUsd * 3) {
        findings.push({ claim: `FDV is ${(fdv / cg.mcapUsd).toFixed(1)}x circulating market cap \u2014 large unlock / dilution overhang.`, tone: "warn", source: "coingecko" });
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
      claim: `Concentrated supply: ${bundleCount} non-contract wallets hold ~${insiderPct}% \u2014 possible bundled launch or coordinated snipe.`,
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
  axes.push({ key: "T5", label: "Trading authenticity", score: aT5, weight: 12, rationale: washSignature ? `vol/liquidity ${volLiq.toFixed(1)}x but price flat (${pc24.toFixed(1)}%) \u2014 wash-trade signature.` : `24h vol/liquidity ${volLiq.toFixed(2)}x, ${buys} buys / ${sells} sells.` });
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
  const topHolders = rawHolders.slice(0, 5).map((h) => ({
    address: h.address ?? h.account ?? "",
    percent: Number(h.percent) * 100,
    tag: h.tag || void 0,
    isContract: h.is_contract === 1 || h.is_contract === "1"
  })).filter((h) => h.address);
  const graph = buildGraph(pair.baseToken.symbol, verdict, projectX, deployer, topHolders, socials);
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
function buildGraph(symbol, verdict, projectX, deployer, holders, socials) {
  const center = "$" + symbol;
  const nodes = [{ type: "Company", key: center, subject: true, was_rug: verdict === "AVOID" }];
  const edges = [];
  if (projectX) {
    nodes.push({ type: "Person", key: projectX });
    edges.push({ src: center, dst: projectX, type: "TEAM" });
  }
  if (deployer) {
    const k = "wallet:" + deployer.slice(0, 8);
    nodes.push({ type: "Identity", subtype: "Wallet", key: k });
    edges.push({ src: center, dst: k, type: "DEPLOYED_BY" });
  }
  holders.slice(0, 4).forEach((h) => {
    const k = (h.tag || "holder") + ":" + h.address.slice(0, 8);
    nodes.push({ type: "Identity", subtype: "Wallet", key: k, concentration: h.percent });
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
var DEX_URL = /dexscreener\.com\/([a-z0-9]+)\/([a-zA-Z0-9]+)/i;
var HTTP_URL = /^https?:\/\//i;
var DOMAIN = /^([a-z0-9-]+\.)+[a-z]{2,24}(\/\S*)?$/i;
var NAME_SERVICE = /\.(eth|sol|crypto|nft|bnb|x|lens)$/i;
function resolveInput(raw) {
  const s = raw.trim();
  const dex = s.match(DEX_URL);
  if (dex) return { kind: "token", ref: s, via: "dexscreener" };
  if (EVM.test(s)) return { kind: "token", ref: s, via: "evm" };
  if (!s.startsWith("@") && !/twitter\.com|x\.com/i.test(s) && SOLANA.test(s) && s.length >= 32) {
    return { kind: "token", ref: s, via: "solana" };
  }
  const NOISE = /^(home|explore|notifications|messages|i|intent|search|hashtag|settings|share|status|about|tos|privacy)$/i;
  const xUrl = s.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,30})/i);
  if (xUrl && !NOISE.test(xUrl[1])) return { kind: "handle", ref: xUrl[1] };
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
