// server/config.ts
var PROVIDERS = [
  { id: "grok", label: "Grok (X content)", env: ["XAI_API_KEY"], free: false, feeds: "testimonial acknowledgment, recent activity, sentiment" },
  { id: "twitterapi", label: "twitterapi.io (X follow graph)", env: ["TWITTERAPI_KEY"], free: false, feeds: "follower/following graph, profile, account age" },
  { id: "coingecko", label: "CoinGecko", env: ["COINGECKO_API_KEY"], free: true, feeds: "token price/mcap, call performance (K2)" },
  { id: "dexscreener", label: "DexScreener", env: [], free: true, feeds: "live DEX liquidity/volume, rug signals" },
  { id: "crunchbase", label: "Crunchbase", env: ["CRUNCHBASE_API_KEY"], free: false, feeds: "ventures, investors, repeat backing (F2/F3/I2)" },
  { id: "peopledatalabs", label: "People Data Labs", env: ["PDL_API_KEY"], free: false, feeds: "identity, career history (F1/F2)" },
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
    label: "Investor / Fund",
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
  ["INVESTOR" /* INVESTOR */]: [
    /\bventure\b/i,
    /\bcapital\b/i,
    /\bVC\b/i,
    /\bfund\b/i,
    /\bGP\b/i,
    /\bgeneral partner\b/i,
    /\blimited partner\b/i,
    /\bportfolio\b/i,
    /\bangel\b/i,
    /\binvest(or|ing|ments?)\b/i,
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
      const key = p.contract_address || "$" + p.ticker;
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
  return {
    handle: ev.profile.handle,
    display_name: ev.profile.display_name,
    avatar: ev.profile.avatar,
    bio: ev.profile.bio,
    followers: ev.profile.followers,
    joined: ev.profile.joined,
    identity_note: ev.profile.identity_note,
    headline: ev.headline,
    live,
    report,
    graph: a.toPanoptes(),
    founderSummary: ev.roles.includes("FOUNDER" /* FOUNDER */) ? a.founderSummary() : void 0,
    evidence: {
      ventures: a.getVentures(),
      testimonials: a.getTestimonials(),
      advised: a.getAdvisedProjects(),
      associates: a.getAssociates()
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
    recentActivity: []
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
    headline: "",
    recentActivity: []
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
    const block = data.content.find((b) => b.type === "tool_use");
    return block?.input ?? null;
  } catch (e) {
    console.error("[agent] request failed", e);
    return null;
  }
}
async function extractClaims(handle, bio, posts) {
  const system = "You are ARGUS intake. From a subject's own bio and recent posts, extract the claims they make about themselves so they can be verified later. Capture CLAIMS ONLY, never judge truth. Roles drawn from: FOUNDER, KOL, INVESTOR, ADVISOR, AGENCY, MEMBER. Ventures = companies/projects they say they founded or led. Testimonials = named people/accounts they cite as backers or endorsers. Advised = projects they claim to advise. Promotions = tokens/tickers they shill. Use the @handle form for accounts. Omit anything not actually claimed. Never use em dashes.";
  const user = `Subject: ${handle}
Bio: ${bio || "(none)"}

Recent posts:
${posts.slice(0, 20).map((p, i) => `${i + 1}. ${p}`).join("\n") || "(none)"}`;
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
  return structured(system, user, tool, 2048);
}
async function analyzeSubject(handle, roles, axisCatalog2, evidenceJson) {
  const system = "You are ARGUS, a forensic crypto due-diligence analyst. You score a subject on a fixed set of axes from collected evidence only. Be skeptical: a strong story never papers over a disqualifying fact. Score conservatively when evidence is thin. Each axis score must be between 0 and its weight. Write one tight rationale per axis citing the evidence. Never use em dashes.";
  const user = `Subject: ${handle}
Held roles: ${roles.join(", ")}

Axes to score (axis | weight | role):
` + axisCatalog2.map((a) => `- ${a.axis} | max ${a.weight} | ${a.role}`).join("\n") + `

Collected evidence (JSON):
${evidenceJson}

Score every listed axis, write the composite headline (one sentence on what governs the verdict), and an identity note.`;
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
        identity_note: { type: "string" }
      },
      required: ["axes", "headline", "identity_note"]
    }
  };
  return structured(system, user, tool, 3e3);
}

// server/adapters/x.ts
var TWITTERAPI = "https://api.twitterapi.io";
var XAI = "https://api.x.ai/v1/chat/completions";
async function getProfile2(handle) {
  const key = env("TWITTERAPI_KEY");
  if (!key) return null;
  const u = handle.replace(/^@/, "");
  try {
    const res = await fetch(`${TWITTERAPI}/twitter/user/info?userName=${encodeURIComponent(u)}`, {
      headers: { "x-api-key": key }
    });
    if (!res.ok) return null;
    const d = await res.json();
    const p = d.data ?? d;
    return {
      handle: "@" + u,
      name: p.name,
      bio: p.description,
      followers: p.followers ?? p.followers_count,
      createdAt: p.createdAt ?? p.created_at
    };
  } catch {
    return null;
  }
}
async function getRecentPosts(handle, limit = 20) {
  const key = env("TWITTERAPI_KEY");
  if (!key) return [];
  const u = handle.replace(/^@/, "");
  try {
    const res = await fetch(`${TWITTERAPI}/twitter/user/last_tweets?userName=${encodeURIComponent(u)}`, {
      headers: { "x-api-key": key }
    });
    if (!res.ok) return [];
    const d = await res.json();
    const tweets = d.tweets ?? d.data ?? [];
    return tweets.map((t) => t.text ?? t.full_text ?? "").filter(Boolean).slice(0, limit);
  } catch {
    return [];
  }
}
async function followsSubject(endorser, subject) {
  const key = env("TWITTERAPI_KEY");
  if (!key) return null;
  const e = endorser.replace(/^@/, "");
  const s = subject.replace(/^@/, "").toLowerCase();
  try {
    const res = await fetch(`${TWITTERAPI}/twitter/user/followings?userName=${encodeURIComponent(e)}&pageSize=200`, {
      headers: { "x-api-key": key }
    });
    if (!res.ok) return null;
    const d = await res.json();
    const list = d.followings ?? d.data ?? [];
    return list.some((u) => (u.userName ?? u.screen_name ?? "").toLowerCase() === s);
  } catch {
    return null;
  }
}
async function acknowledgment(endorser, subject) {
  const key = env("XAI_API_KEY");
  if (!key) return null;
  const e = endorser.replace(/^@/, "");
  const s = subject.replace(/^@/, "");
  try {
    const res = await fetch(XAI, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: env("ARGUS_GROK_MODEL") || "grok-4-fast",
        messages: [
          {
            role: "system",
            content: "You verify endorsements for a due-diligence engine. Decide the strongest public acknowledgment @" + e + " has ever made of @" + s + ' on X, and overall sentiment. Reply with ONLY a compact JSON object {"ack":"none|mention|thanks|endorsement","sentiment":"positive|neutral|negative|none"}.'
          },
          { role: "user", content: `Has @${e} ever publicly acknowledged @${s}?` }
        ],
        search_parameters: {
          mode: "on",
          sources: [{ type: "x", x_handles: [e] }],
          max_search_results: 20
        }
      })
    });
    if (!res.ok) return null;
    const d = await res.json();
    const text = d.choices?.[0]?.message?.content ?? "";
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]);
    return { ack: parsed.ack ?? "none", sentiment: parsed.sentiment ?? "none" };
  } catch {
    return null;
  }
}
function fmtFollowers(n) {
  if (!n) return "\u2014";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}
var xAdapter = {
  id: "x",
  label: "X (Grok + twitterapi.io)",
  available: () => !!env("TWITTERAPI_KEY") || !!env("XAI_API_KEY"),
  async run(ctx) {
    const prof = ctx.evidence.profile.bio ? null : await getProfile2(ctx.handle);
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
    const claims = [...ctx.evidence.testimonials, ...ctx.evidence.advised];
    for (const t of claims) {
      const endorser = t.claimed_endorser_handle || t.project_handle;
      if (!endorser) continue;
      const follows = await followsSubject(endorser, ctx.handle);
      const ack = await acknowledgment(endorser, ctx.handle);
      if (follows !== null) t.follows_subject = follows;
      if (ack) {
        t.public_acknowledgment = ack.ack;
        t.sentiment = ack.sentiment;
        t.relationship_corroborated = ack.ack === "endorsement" || ack.ack === "thanks";
        t.fud_present = ack.sentiment === "negative";
      }
      t.corroboration_verdict = classifyTestimonial(t);
      const tone = t.corroboration_verdict === "Contradicted" /* CONTRADICTED */ ? "bad" : t.corroboration_verdict === "Corroborated" /* CORROBORATED */ ? "good" : "warn";
      ctx.emit({ phase: "Corroborate", label: `${endorser}`, detail: `${t.corroboration_verdict}${follows === false ? " \xB7 does not follow subject" : ""}`, source: "X", tone });
    }
  }
};

// server/adapters/peopledatalabs.ts
var BASE = "https://api.peopledatalabs.com/v5";
async function enrichPerson(params) {
  const key = env("PDL_API_KEY");
  if (!key) return null;
  const qs = new URLSearchParams();
  if (params.profile) qs.set("profile", params.profile);
  if (params.name) qs.set("name", params.name);
  qs.set("min_likelihood", "6");
  try {
    const res = await fetch(`${BASE}/person/enrich?${qs}`, { headers: { "X-Api-Key": key } });
    if (!res.ok) return null;
    const d = await res.json();
    const p = d.data;
    if (!p) return null;
    return {
      fullName: p.full_name,
      jobTitle: p.job_title,
      jobCompany: p.job_company_name,
      experience: (p.experience ?? []).map((x) => ({
        company: x.company?.name,
        title: x.title?.name,
        start: x.start_date,
        end: x.end_date
      })),
      linkedin: p.linkedin_url
    };
  } catch {
    return null;
  }
}
var peopledatalabsAdapter = {
  id: "peopledatalabs",
  label: "People Data Labs",
  available: () => !!env("PDL_API_KEY"),
  async run(ctx) {
    const name = ctx.evidence.profile.display_name;
    if (!name || name === ctx.handle.replace(/^@/, "")) return;
    ctx.emit({ phase: "P1 \xB7 Identity", label: "Identity resolution", detail: `Enriching ${name} via People Data Labs\u2026`, tone: "neutral" });
    const person = await enrichPerson({ name });
    if (!person) {
      ctx.emit({ phase: "P1 \xB7 Identity", label: "No match", detail: "No real-world identity record; scored as pseudonymous (no penalty).", source: "peopledatalabs", tone: "neutral" });
      return;
    }
    ctx.evidence.profile.identity_confidence = person.linkedin ? "Probable" : ctx.evidence.profile.identity_confidence;
    ctx.evidence.profile.identity_note = `Resolved to ${person.fullName}, ${person.jobTitle ?? "role unknown"} @ ${person.jobCompany ?? "n/a"}. ${person.experience.length} prior roles on record.`;
    ctx.emit({ phase: "P1 \xB7 Identity", label: "Identity resolved", detail: `${person.fullName} \xB7 ${person.experience.length} verified roles`, source: "peopledatalabs", tone: "good" });
  }
};

// server/adapters/crunchbase.ts
var BASE2 = "https://api.crunchbase.com/api/v4";
async function lookupOrganization(name) {
  const key = env("CRUNCHBASE_API_KEY");
  if (!key) return null;
  try {
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
  const headers = key ? { "x-cg-pro-api-key": key } : {};
  try {
    const res = await fetch(`${base}/coins/${platform}/contract/${address}`, { headers });
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

// server/orchestrate.ts
var ADAPTERS = [
  xAdapter,
  peopledatalabsAdapter,
  crunchbaseAdapter,
  dexscreenerAdapter,
  coingeckoAdapter,
  redditAdapter,
  onchainAdapter
];
var KEYED = /* @__PURE__ */ new Set(["x", "peopledatalabs", "crunchbase", "reddit", "onchain"]);
var delay = (ms) => new Promise((r) => setTimeout(r, ms));
function parseOutcome(s) {
  if (!s) return "Unknown" /* UNKNOWN */;
  const match = Object.values(VentureOutcome).find((v) => v.toLowerCase() === s.toLowerCase());
  return match ?? "Unknown" /* UNKNOWN */;
}
function asRoles(roles) {
  const valid = new Set(Object.values(SubjectClass));
  return roles.filter((r) => valid.has(r)).map((r) => r);
}
async function coldIntake(ctx) {
  const prof = await getProfile2(ctx.handle);
  if (prof) {
    ctx.evidence.profile.display_name = prof.name ?? ctx.evidence.profile.display_name;
    ctx.evidence.profile.bio = prof.bio ?? "";
    ctx.emit({ phase: "P0 \xB7 Intake", label: "Resolve profile", detail: `${prof.name ?? ctx.handle}`, source: "twitterapi.io", tone: "neutral" });
  }
  const posts = await getRecentPosts(ctx.handle);
  if (posts.length) ctx.evidence.recentActivity = posts;
  if (!analystAvailable()) return;
  ctx.emit({ phase: "P0 \xB7 Intake", label: "Extract claims", detail: "Reading the subject's bio and posts for self-claims to verify\u2026", tone: "neutral" });
  const claims = await extractClaims(ctx.handle, ctx.evidence.profile.bio, posts);
  if (!claims) return;
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
  ctx.emit({ phase: "P0 \xB7 Intake", label: "Claims extracted", detail: `${n} claims across ${ctx.evidence.roles.join(", ") || "no roles"} \u2014 now verifying each.`, source: "claude", tone: "neutral" });
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
  if (analystAvailable()) {
    emit({ phase: "Analyst", label: "Score axes", detail: "Claude analyst scoring every axis from the collected evidence\u2026", tone: "neutral" });
    const evidenceJson = JSON.stringify(
      {
        profile: evidence.profile,
        ventures: evidence.ventures,
        testimonials: evidence.testimonials,
        advised: evidence.advised,
        promotions: evidence.promotions,
        wallets: evidence.wallets,
        findings: evidence.findings
      },
      null,
      0
    ).slice(0, 12e3);
    const verdict = await analyzeSubject(evidence.profile.handle, evidence.roles, axisCatalog(evidence.roles), evidenceJson);
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
  return assembleDossier(evidence, true);
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
async function coingeckoToken(chain, address) {
  const plat = CG_PLATFORM[chain] ?? chain;
  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/coins/${plat}/contract/${address}?localization=false&tickers=true&market_data=true&community_data=false&developer_data=false`);
    if (res.status === 404) return { listed: false, rank: null, mcapUsd: null, marketCount: 0, cexCount: 0 };
    if (!res.ok) return null;
    const d = await res.json();
    const tickers = d.tickers ?? [];
    const markets = new Set(tickers.map((t) => t.market?.name).filter(Boolean));
    const cex = new Set(tickers.filter((t) => !CG_DEX.test(t.market?.identifier || t.market?.name || "")).map((t) => t.market?.name).filter(Boolean));
    return { listed: true, rank: d.market_cap_rank ?? null, mcapUsd: d.market_data?.market_cap?.usd ?? null, marketCount: markets.size, cexCount: cex.size };
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
var num = (s) => s == null || s === "" ? null : Number(s);
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
function evmSafety(gp, sim) {
  const s = sim;
  const topHolderPct = gp?.holders?.length ? Number(gp.holders[0].percent) * 100 : null;
  const lpLocked = (gp?.lp_holders?.some((h) => h.is_locked === 1) ?? false) || (gp?.lp_holders?.reduce((a, h) => a + (h.is_locked ? Number(h.percent) : 0), 0) ?? 0) > 0.5;
  return {
    available: !!gp || !!s,
    simChecked: !!s,
    honeypot: t1(gp?.is_honeypot) || (s?.isHoneypot ?? false),
    honeypotOnchain: t1(gp?.is_honeypot) || t1(gp?.cannot_sell_all),
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
    buyTax: s?.simSuccess ? s.buyTax : (num(gp?.buy_tax) ?? 0) * 100,
    sellTax: s?.simSuccess ? s.sellTax : (num(gp?.sell_tax) ?? 0) * 100,
    holderCount: num(gp?.holder_count) ?? 0,
    topHolderPct,
    lpLocked
  };
}
function solanaSafety(sol) {
  const topHolderPct = sol?.holders?.length ? Number(sol.holders[0].percent) * 100 : null;
  const lpLocked = sol?.lp_holders?.some((h) => h.is_locked === 1) ?? false;
  const mintable = solFlag(sol?.mintable);
  const freezable = solFlag(sol?.freezable);
  return {
    available: !!sol,
    simChecked: false,
    honeypot: !!sol?.non_transferable && sol.non_transferable === "1",
    honeypotOnchain: sol?.non_transferable === "1",
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
    holderCount: num(sol?.holder_count) ?? 0,
    topHolderPct,
    lpLocked
  };
}
function emptySafety() {
  return {
    available: false,
    simChecked: false,
    honeypot: false,
    honeypotOnchain: false,
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
    lpLocked: false
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
  const ageDays = pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / 864e5 : void 0;
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
    if (s.sellTax >= 20) findings.push({ claim: `Sell tax is ${s.sellTax.toFixed(0)}%.`, tone: "bad", source: s.simChecked ? "sim" : "goplus" });
    if (s.simChecked && !s.honeypot) findings.push({ claim: `Sell simulation passed (buy ${s.buyTax.toFixed(0)}% / sell ${s.sellTax.toFixed(0)}%).`, tone: "good", source: "honeypot.is" });
    if (s.ownerRenounced && !s.mintable && !s.takeBack && !s.freezable) findings.push({ claim: chain === "solana" ? "Mint and freeze authority revoked." : "Ownership renounced; no mint or take-back.", tone: "good", source: "goplus" });
    if (s.lpLocked) findings.push({ claim: "Liquidity is locked.", tone: "good", source: "goplus" });
    else findings.push({ claim: "Liquidity does not appear locked or burned.", tone: "warn", source: "goplus" });
  }
  if (liquidityUsd < 15e3) findings.push({ claim: `Thin liquidity ($${Math.round(liquidityUsd).toLocaleString()}). Easy to drain or move.`, tone: "warn", source: "dexscreener" });
  if (ageDays != null && ageDays < 7) findings.push({ claim: `Pair is ${ageDays < 1 ? "under a day" : Math.round(ageDays) + " days"} old.`, tone: "warn", source: "dexscreener" });
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
  if (s.lpLocked) aT1 = clamp(aT1 + 2, 0, 24);
  else if (s.available) aT1 = clamp(aT1 - 3, 0, 24);
  axes.push({ key: "T1", label: "Liquidity & lock", score: aT1, weight: 24, rationale: `$${Math.round(liquidityUsd).toLocaleString()} pooled${s.available ? s.lpLocked ? ", LP locked" : ", LP not locked" : ""}.` });
  let aT2 = 26;
  if (!s.available) aT2 = 9;
  else if (chain === "solana") {
    if (s.metadataMutable) aT2 -= 8;
    if (!s.ownerRenounced) aT2 -= 6;
  } else {
    if (!s.openSource) aT2 -= 8;
    if (s.pausable) aT2 -= 8;
    if (s.selfdestruct) aT2 -= 10;
    if (!s.ownerRenounced) aT2 -= 4;
  }
  aT2 = clamp(aT2, 0, 26);
  axes.push({ key: "T2", label: "Contract safety", score: aT2, weight: 26, rationale: s.available ? chain === "solana" ? `${s.ownerRenounced ? "authorities revoked" : "mint/freeze authority active"}${s.metadataMutable ? ", metadata mutable" : ""}.` : `${s.openSource ? "verified" : "unverified"} source, ${s.ownerRenounced ? "ownership renounced" : "owner active"}${s.pausable ? ", pausable" : ""}.` : "On-chain safety not verifiable keyless on this chain." });
  const tax = s.buyTax + s.sellTax;
  let aT3 = !s.available ? 6 : tax === 0 ? 12 : tax <= 10 ? 10 : tax <= 20 ? 7 : tax <= 40 ? 3 : 0;
  if (s.cannotSellAll || s.nonTransferable) aT3 = 0;
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
  aT4 = clamp(aT4, 0, 16);
  const t4Note = !s.available ? "Holder data not verifiable keyless." : !holdersReliable ? `${s.holderCount.toLocaleString()} holders; distribution not reliably reported by the free data tier.` : `${s.holderCount.toLocaleString()} holders${topPct != null ? `, top holder ${topPct.toFixed(0)}%` : ""}${bundleRisk !== "low" ? `, ~${insiderPct}% in ${bundleCount} fresh wallets` : ""}.`;
  axes.push({ key: "T4", label: "Holder distribution", score: aT4, weight: 16, rationale: t4Note });
  const volLiq = liquidityUsd > 0 ? vol24 / liquidityUsd : 0;
  let aT5 = vol24 < 500 ? 4 : volLiq > 25 ? 4 : volLiq > 8 ? 7 : volLiq < 0.02 ? 5 : 11;
  const total = buys + sells;
  if (total > 20 && sells / total > 0.8) aT5 = clamp(aT5 - 2, 0, 12);
  axes.push({ key: "T5", label: "Trading authenticity", score: aT5, weight: 12, rationale: `24h vol/liquidity ${volLiq.toFixed(2)}x, ${buys} buys / ${sells} sells.` });
  const socials = [
    ...(pair.info?.websites ?? []).map((w) => ({ label: "site", url: w.url })),
    ...(pair.info?.socials ?? []).map((x) => ({ label: x.type, url: x.url }))
  ];
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
  const projectX = handleFromUrl((pair.info?.socials ?? []).find((x) => /twitter|x/i.test(x.type))?.url) || handleFromUrl((pair.info?.websites ?? []).map((w) => w.url).find((u) => /x\.com|twitter\.com/i.test(u)));
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
    symbol: pair.baseToken.symbol,
    name: pair.baseToken.name,
    imageUrl: pair.info?.imageUrl,
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
  holders.slice(0, 4).forEach((h, i) => {
    const k = (h.tag || "holder") + ":" + h.address.slice(0, 6) + i;
    nodes.push({ type: "Identity", subtype: "Wallet", key: k, concentration: h.percent });
    edges.push({ src: center, dst: k, type: "HELD_BY", verdict: h.percent > 25 ? "Contradicted" : void 0 });
  });
  socials.slice(0, 2).forEach((x) => {
    nodes.push({ type: "Company", key: x.label });
    edges.push({ src: center, dst: x.label, type: "LINKS" });
  });
  return { nodes, edges };
}
function buildHeadline(verdict, cap, s, liq, projectX) {
  if (s.honeypot) return s.nonTransferable ? "Non-transferable: holders are locked in. Do not touch." : "Honeypot: buyers cannot sell. Do not touch.";
  if (cap === "mint_authority_active") return "Mint authority is live, the team can dilute holders to zero.";
  if (cap === "freeze_authority_active") return "Freeze authority is live, the team can freeze your tokens at any time.";
  if (cap === "reclaimable_ownership") return "Ownership can be reclaimed after renouncement, a classic rug setup.";
  if (verdict === "PASS") return `Clears the forensic bar: ${s.ownerRenounced ? "authorities revoked" : "owned"}, ${s.lpLocked ? "LP locked" : "tradeable"}, with real depth${projectX ? `. Team: ${projectX}` : "."}`;
  if (verdict === "CAUTION") return `Tradeable but with reservations${liq < 15e3 ? "; liquidity is thin" : ""}. Size accordingly.`;
  if (!s.available) return "Scored on market data only; on-chain contract safety could not be verified keyless on this chain.";
  return "Falls short on the forensic checks. Treat as high risk.";
}

// src/lib/resolveInput.ts
var EVM = /^0x[a-fA-F0-9]{40}$/;
var SOLANA = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
var DEX_URL = /dexscreener\.com\/([a-z0-9]+)\/([a-zA-Z0-9]+)/i;
function resolveInput(raw) {
  const s = raw.trim();
  const dex = s.match(DEX_URL);
  if (dex) return { kind: "token", ref: s, via: "dexscreener" };
  if (EVM.test(s)) return { kind: "token", ref: s, via: "evm" };
  if (!s.startsWith("@") && !/twitter\.com|x\.com/i.test(s) && SOLANA.test(s) && s.length >= 32) {
    return { kind: "token", ref: s, via: "solana" };
  }
  return { kind: "handle", ref: s };
}
export {
  auditToken,
  providerStatus,
  resolveInput,
  runAudit
};
