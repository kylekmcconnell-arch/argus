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
    const identity = this.identity;
    const sharedKeys = this.sharedCapsTriggered();
    const doxBonus = identity ? DOX_BONUS[identity] ?? 0 : 0;
    const roleReports = [];
    for (const role of this.roles) {
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
      investigative_leads: this.investigativeLeads(),
      finalized_at: (/* @__PURE__ */ new Date(0)).toISOString()
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
    const nodes = [{ type: "Person", key: this.handle, roles: this.roles, subject: true }];
    const edges = [];
    for (const a of this.associates) {
      nodes.push({ type: "Person", key: a.associate_key, in_cabal_kb: !!a.in_cabal_kb });
      edges.push({ src: this.handle, dst: a.associate_key, type: "ASSOCIATES_WITH", relation: a.relation });
    }
    for (const v of this.ventures) {
      const key = canonicalEntityKey({ handle: v.x_handle, domain: v.domain, name: v.project_name });
      nodes.push({ type: "Company", key, label: v.project_name, outcome: v.outcome });
      edges.push({ src: this.handle, dst: key, type: "FOUNDED", outcome: v.outcome });
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
  const identityGrounded = (row) => row.evidence_origin !== "model_lead" && row.artifact_verified === true;
  const groundedWebTeam = (ev.webTeam ?? []).filter(identityGrounded).map((member) => ({
    ...member,
    ...member.identity_link_evidence_origin === "model_lead" ? { handle: void 0, linkedin: void 0 } : {},
    ...member.projects_evidence_origin === "model_lead" ? { projects: [] } : {}
  }));
  const webTeamLeads = (ev.webTeam ?? []).flatMap((member) => {
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
  for (const p of ev.webTeam ?? []) {
    if (!governingEligible(p)) continue;
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
        eligibleAxes: [...artifact.eligibleAxes]
      }))
    } : {},
    notableFollowers: ev.notableFollowers,
    contradictions: ev.contradictions,
    webTeam: groundedWebTeam,
    ...webTeamLeads.length ? { webTeamLeads } : {},
    ventureTeams: ev.ventureTeams ?? [],
    sourceArtifacts: ev.sourceArtifacts,
    profileAuthenticity: ev.profileAuthenticity,
    trustGraphScreen: ev.trustGraphScreen,
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
    sourceArtifacts: []
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
  const clean = next?.trim();
  if (!clean || current?.includes(clean)) return current;
  return [current, clean].filter(Boolean).join(" \xB7 ").slice(0, 500);
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
  claude.calls += 1;
  claude.in += tin;
  claude.out += tout;
  recordCall(
    "claude",
    op,
    tin * PRICE.claudeIn + tout * PRICE.claudeOut,
    [`${tin + tout} tok`, outcomeMeta].filter(Boolean).join(" \xB7 "),
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

// src/lib/investigationRuntime.ts
var DEEP_INVESTIGATION_MAX_DURATION_SECONDS = 600;
var ANALYST_SCORING_TIMEOUT_MS = 18e4;
var ANALYST_REPAIR_TIMEOUT_MS = 9e4;
var ANALYST_FINALIZATION_RESERVE_MS = 9e4;

// server/agent.ts
var ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
var SCHEMA_COMPILATION_ERROR = /compiled grammar is too large|schema is too complex for compilation/i;
var failureMeta = (error, timeoutMs, fallback) => error instanceof Error && error.name === "TimeoutError" ? `timeout_${timeoutMs}ms` : fallback;
function analystAvailable() {
  return !!env("ANTHROPIC_API_KEY");
}
async function structured(system, user, tool, maxTokens = 2048, timeoutMs = 6e4) {
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
async function scanContradictions(handle, evidenceJson, options = {}) {
  const system = "You are ARGUS contradiction analysis. From everything collected about a subject, find INTERNAL CONTRADICTIONS: where the subject's own stated claims conflict with each other or with the collected evidence. Examples: claims a team of N but only one builder is found; claims an audit but no auditor or verification exists; claims a named backer who never acknowledges them; a stated launch/founding date that conflicts with the account age, domain age, or on-chain history; claims 'doxxed' but no real identity resolves; claims locked liquidity that on-chain shows unlocked; a partnership the partner never confirmed; a venture in the bio that discovery found no evidence for. Be STRICT and grounded: report ONLY genuine contradictions, each with the EXACT claim and the EXACT conflicting fact from the evidence. A missing or unverifiable data point is a GAP, not a contradiction; never report gaps, and never invent. If there are none, return an empty list. Never use em dashes. SCOPE RULES \u2014 these are NOT contradictions: (1) ARGUS's OWN analysis metadata (fields like identity_confidence, identity_note, verdicts, evidence notes such as 'single-source lead, unverified') disagreeing with other ARGUS fields \u2014 only the SUBJECT's outward claims vs external facts count; a low-confidence evidence note is a gap, not a conflict. (2) Normal vertical integration: a project's token running on its own chain, its dApp on its own platform, or its products naming each other is how ecosystems work, not circularity. (3) Marketing self-description ('#1', 'leading') vs modest traction is puffery to note in scoring, not a contradiction, unless it conflicts with a specific verifiable fact. INVESTIGATIVE LEAD EXCLUSION: investigative leads are excluded from this evidence packet. Do not infer anything about the subject from their absence. FINDING ATTRIBUTION RULE: when comparing or interpreting finding collections, attribute only direct-subject findings to the audited subject. A claim targeting an associate or venture cannot contradict the subject's claims unless separate direct-subject evidence explicitly connects the conduct to the subject. Never rewrite an associate's allegation as the subject's allegation. This attribution rule is specific to finding collections; profile, team, wallet, check-outcome, and other non-finding evidence in the packet remain legitimate evidence for testing the subject's claims.";
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
function validateAnalystVerdict(value, axisCatalog2, evidenceCatalog = [], onReject) {
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
    const coverage = validRefs(rawCoverage, 0, 4);
    if (!ARTIFACT_ID.test(primary) || !additional || !coverage) {
      return reject(`axis-reference-shape:${row.axis}`);
    }
    const supportRefs = [primary, ...additional];
    const coverageRefs = coverage;
    const evidenceRefs = [...supportRefs, ...coverageRefs];
    if (new Set(evidenceRefs).size !== evidenceRefs.length) {
      return reject(`duplicate-evidence-reference:${row.axis}`);
    }
    const counterEvidenceRefs = validRefs(row.counterEvidenceRefs, 0, 8);
    const gaps = validGaps(row.gaps);
    if (evidenceRefs.length > 12 || !counterEvidenceRefs || !gaps) {
      return reject(`axis-arrays-invalid:${row.axis}`);
    }
    if (counterEvidenceRefs.some((ref) => evidenceRefs.includes(ref))) {
      return reject(`support-counter-overlap:${row.axis}`);
    }
    const everyRefEligible = [...evidenceRefs, ...counterEvidenceRefs].every((ref) => {
      const artifact = artifacts.get(ref);
      return artifact?.eligibleAxes.includes(row.axis);
    });
    if (!everyRefEligible) return reject(`axis-ineligible-reference:${row.axis}`);
    if (!evidenceRefs.some((ref) => isSubstantiveArtifact(artifacts.get(ref)))) {
      return reject(`missing-substantive-support:${row.axis}`);
    }
    if (!supportRefs.every((ref) => isSubstantiveArtifact(artifacts.get(ref)))) {
      return reject(`non-substantive-support:${row.axis}`);
    }
    if (!coverageRefs.every((ref) => !isSubstantiveArtifact(artifacts.get(ref)))) {
      return reject(`substantive-coverage-reference:${row.axis}`);
    }
    if (evidenceRefs.some((ref) => !isSubstantiveArtifact(artifacts.get(ref))) && gaps.length === 0) {
      return reject(`coverage-without-gap:${row.axis}`);
    }
    if (!counterEvidenceRefs.every((ref) => isSubstantiveArtifact(artifacts.get(ref)))) {
      return reject(`non-substantive-counter-reference:${row.axis}`);
    }
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
  return {
    // Canonical order makes downstream completeness checks and snapshots stable.
    axes: axisCatalog2.map((spec) => seen.get(spec.axis)),
    headline,
    identity_note: identityNote
  };
}
var ANALYST_EVIDENCE_MAX_CHARS = 24e3;
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
    "P5_traction_and_liveness",
    "P6_transparency_integrity",
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
    "I2_portfolio_quality",
    "I3_fund_scale_tier",
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
  notableFollowers: ["F6_network_quality", "P4_backing_and_partners", "P5_traction_and_liveness", "K5_cabal_fud", "I2_portfolio_quality", "I4_testimonial_corroboration", "I5_reputation_fud", "AG4_reputation_fud", "AD3_relationship_corroboration", "AD5_reputation_fud", "ME2_role_authenticity", "ME3_conduct_reputation"],
  recentActivity: [
    "F2_track_record",
    "F4_build_substance",
    "F5_reputation_integrity",
    "P2_product_substance",
    "P3_token_conduct",
    "P5_traction_and_liveness",
    "P6_transparency_integrity",
    "K2_call_performance",
    "K3_disclosure_deletion",
    "K5_cabal_fud",
    "I2_portfolio_quality",
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
var IDENTITY_LEAD_FINDING_AXES = [
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
];
var FINDING_AXIS_ELIGIBILITY = {
  CommunityFUD: REPUTATION_FINDING_AXES,
  LegalCaseNameLead: IDENTITY_LEAD_FINDING_AXES,
  SanctionsNameLead: IDENTITY_LEAD_FINDING_AXES,
  SiteNotLive: ["F4_build_substance", "P2_product_substance", "P5_traction_and_liveness", "P6_transparency_integrity"],
  TokenCollapse: ["F5_reputation_integrity", "P3_token_conduct", "K2_call_performance", "K4_onchain_conduct"],
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
    "P3_token_conduct",
    "K3_disclosure_deletion",
    "K4_onchain_conduct",
    "AG3_service_integrity",
    "AD4_advisory_conduct"
  ]
};
var CHECK_AXIS_ELIGIBILITY = {
  "identity-resolution": ["F1_identity_verifiability", "P1_team_and_identity", "K1_identity_roster", "I1_identity_legitimacy", "AG1_identity_legitimacy", "AD1_identity_verifiability", "ME1_identity"],
  "profile-photo-authenticity": [],
  "code-footprint-github": ["F2_track_record", "F4_build_substance", "P2_product_substance", "P5_traction_and_liveness", "ME2_role_authenticity"],
  "identity-continuity": ["F1_identity_verifiability", "F5_reputation_integrity", "P1_team_and_identity", "P6_transparency_integrity", "K1_identity_roster", "K3_disclosure_deletion", "I1_identity_legitimacy", "AG1_identity_legitimacy", "AD1_identity_verifiability", "ME1_identity"],
  "affiliations-associates": ["F2_track_record", "F3_repeat_backing", "F6_network_quality", "P4_backing_and_partners", "K5_cabal_fud", "I2_portfolio_quality", "I4_testimonial_corroboration", "AD3_relationship_corroboration", "ME2_role_authenticity"],
  "promoted-token-performance": ["P3_token_conduct", "K2_call_performance", "K3_disclosure_deletion", "K4_onchain_conduct", "K5_cabal_fud"],
  "vc-portfolio-track-record": ["F2_track_record", "F3_repeat_backing", "I2_portfolio_quality", "I3_fund_scale_tier"],
  "news-press": ["F2_track_record", "F3_repeat_backing", "F5_reputation_integrity", "P2_product_substance", "P4_backing_and_partners", "P5_traction_and_liveness", "I2_portfolio_quality", "I3_fund_scale_tier", "I5_reputation_fud", "AG2_client_outcomes", "AG4_reputation_fud", "AD2_advised_outcomes", "AD5_reputation_fud", "ME3_conduct_reputation"],
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
    "I2_portfolio_quality",
    "I3_fund_scale_tier",
    "I5_reputation_fud",
    "AG2_client_outcomes",
    "AG4_reputation_fud",
    "AD2_advised_outcomes",
    "AD5_reputation_fud",
    "ME3_conduct_reputation"
  ]
};
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
var stableJson = (value) => {
  const normalize = (candidate) => {
    if (candidate == null || typeof candidate === "string" || typeof candidate === "boolean") return candidate;
    if (typeof candidate === "number") return Number.isFinite(candidate) ? candidate : null;
    if (Array.isArray(candidate)) return candidate.map(normalize);
    if (typeof candidate !== "object") return null;
    return Object.fromEntries(
      Object.keys(candidate).sort().filter((key) => candidate[key] !== void 0).map((key) => [key, normalize(candidate[key])])
    );
  };
  return JSON.stringify(normalize(value));
};
var evidencePayload = (value) => {
  const base = value && typeof value === "object" && !Array.isArray(value) ? { ...value } : { value };
  delete base.artifactId;
  return base;
};
var eligibleAxesFor = (section, value, axisCatalog2) => {
  const checkId = typeof value.checkId === "string" ? value.checkId : typeof value.check_id === "string" ? value.check_id : "";
  const findingType = typeof value.finding_type === "string" ? value.finding_type : "";
  const eligible = section === "profile" && value.profile_collection_state !== "resolved" ? [] : section === "findings" ? FINDING_AXIS_ELIGIBILITY[findingType] ?? [] : section === "checkOutcomes" && checkId ? CHECK_AXIS_ELIGIBILITY[checkId] ?? [] : section === "sourceArtifacts" ? SOURCE_ARTIFACT_AXIS_ELIGIBILITY[sourceArtifactKind(value)] ?? [] : SECTION_AXIS_ELIGIBILITY[section] ?? [];
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
var safeArtifactSourceUrl = (value) => {
  if (!value) return void 0;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:" || url.username || url.password || !url.hostname) {
      return void 0;
    }
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:access[_-]?token|api[_-]?key|key|token|signature|sig|auth)$/i.test(key)) {
        url.searchParams.delete(key);
      }
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
  "link_evidence_url"
]);
var sanitizeArtifactUrls = (value, depth = 0) => {
  if (value == null || typeof value !== "object" || depth > 4) return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeArtifactUrls(item, depth + 1));
  const sanitized = {};
  for (const [key, item] of Object.entries(value)) {
    if (ARTIFACT_URL_FIELDS.has(key) && typeof item === "string") {
      const safe = safeArtifactSourceUrl(item);
      if (safe) sanitized[key] = safe;
      continue;
    }
    sanitized[key] = sanitizeArtifactUrls(item, depth + 1);
  }
  return sanitized;
};
var verificationFor = (section, record2) => {
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
  return "observed";
};
var DIRECT_SECTIONS = /* @__PURE__ */ new Set(["profile", "profileAuthenticity", "findings", "wallets", "promotions", "recentActivity"]);
var providerFor = (section, payload) => {
  const declared = recordText(payload, ["provider"], 100);
  if (declared) return declared;
  if (section === "profile") {
    const profileProvider = recordText(payload, ["profile_provider"], 100);
    if (profileProvider) return profileProvider;
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
var makeAxisArtifact = (section, value, axisCatalog2, eligibleOverride) => {
  const payload = sanitizeArtifactUrls(evidencePayload(value));
  const contentHash = createHash("sha256").update(stableJson({ section, payload })).digest("hex");
  const artifactId = `art_v1_${contentHash}`;
  const eligibleAxes = eligibleOverride ?? eligibleAxesFor(section, payload, axisCatalog2);
  const provider = providerFor(section, payload);
  const operationKey = recordText(payload, ["checkId", "check_id", "finding_type", "kind", "type"], 100);
  const title = recordText(payload, ["title", "label", "claim", "name", "project_name", "handle", "axis"], 180) ?? `${section} evidence`;
  const excerpt = recordText(payload, ["excerpt", "note", "rationale", "evidence", "bio", "detail", "text", "value"], 320);
  const sourceUrl = safeArtifactSourceUrl(
    recordText(payload, ["sourceUrl", "source_url", "evidence_url", "url", "linkedin"], 420)
  );
  const capturedAt = recordText(payload, ["capturedAt", "captured_at", "profile_captured_at", "completedAt", "source_date"], 40);
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
      verification: verificationFor(section, payload),
      scope: DIRECT_SECTIONS.has(section) ? "direct_subject" : "subject_context"
    }
  };
};
var SCORING_SINGLE_SECTIONS = ["profile", "profileAuthenticity", "trustGraphScreen"];
var SCORING_ARRAY_SECTIONS = [
  "findings",
  "ventures",
  "testimonials",
  "advised",
  "promotions",
  "wallets",
  "team",
  "notableFollowers",
  "recentActivity",
  "sourceArtifacts",
  "checkOutcomes",
  "clientEngagements",
  "associates",
  "ventureTeams"
];
function renderScoringPacket(packet, axisCatalog2) {
  const rendered = { ...packet, schema_version: 4 };
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
    const eligibleValues = values.flatMap((value) => {
      const artifact = makeAxisArtifact(section, value, axisCatalog2);
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
  return typeof row.artifactId === "string" && ARTIFACT_ID.test(row.artifactId) && row.kind === "axis_evidence" && typeof row.provider === "string" && !!row.provider && typeof row.operation === "string" && !!row.operation && typeof row.section === "string" && !!row.section && typeof row.title === "string" && !!row.title && (row.excerpt === void 0 || typeof row.excerpt === "string") && (row.sourceUrl === void 0 || typeof row.sourceUrl === "string") && (row.capturedAt === void 0 || typeof row.capturedAt === "string") && typeof row.contentHash === "string" && row.contentHash === row.artifactId.slice("art_v1_".length) && Array.isArray(row.eligibleAxes) && row.eligibleAxes.length > 0 && row.eligibleAxes.every((axis) => typeof axis === "string" && !!axis) && new Set(row.eligibleAxes).size === row.eligibleAxes.length && ["verified", "reported", "observed", "checked_empty", "unavailable"].includes(String(row.verification)) && (row.scope === "direct_subject" || row.scope === "subject_context");
};
function extractScoringEvidenceCatalog(json) {
  let packet;
  try {
    const value = JSON.parse(json);
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    packet = value;
  } catch {
    return [];
  }
  if (!Array.isArray(packet.evidenceCatalog) || !packet.evidenceCatalog.every(isAxisEvidenceRecord)) return [];
  const catalog = packet.evidenceCatalog;
  const byId = new Map(catalog.map((record2) => [record2.artifactId, record2]));
  if (byId.size !== catalog.length) return [];
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
    represented.add(artifactId);
  };
  for (const section of SCORING_SINGLE_SECTIONS) inspect(section, packet[section]);
  for (const section of [...SCORING_ARRAY_SECTIONS, "axisGaps"]) {
    if (Array.isArray(packet[section])) packet[section].forEach((value) => inspect(section, value));
  }
  return represented.size === catalog.length ? catalog.map((record2) => ({ ...record2, eligibleAxes: [...record2.eligibleAxes] })) : [];
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
    profile: compactObject(input.profile),
    profileAuthenticity: compactProfileAuthenticity(input.profileAuthenticity),
    trustGraphScreen: compactTrustGraphScreen(input.trustGraphScreen),
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
    const source = options.includeInvestigativeLeads ? rawSource : rawSource.filter((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return true;
      const record2 = item;
      return record2.evidence_origin !== "model_lead" && record2.artifact_verified !== false;
    });
    const included = source.slice(0, limit).map((item) => compactObject(item)).filter((item) => item !== void 0);
    packet[section] = included;
    coverage[section] = { available: source.length, included: included.length };
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
    "team",
    "providerRuns",
    "associates",
    "clientEngagements",
    "ventureTeams",
    "checkOutcomes",
    "sourceArtifacts"
  ];
  const render = () => options.axisCatalog ? renderScoringPacket(packet, options.axisCatalog) : packet;
  let json = JSON.stringify(render());
  const protectedEvidenceSections = /* @__PURE__ */ new Set(["checkOutcomes", "sourceArtifacts"]);
  while (json.length > ANALYST_EVIDENCE_MAX_CHARS) {
    const section = pruneOrder.find((key) => !protectedEvidenceSections.has(key) && Array.isArray(packet[key]) && packet[key].length > 0);
    if (!section) break;
    packet[section].pop();
    coverage[section].included = packet[section].length;
    json = JSON.stringify(render());
  }
  while (json.length > ANALYST_EVIDENCE_MAX_CHARS && findings.length > 1) {
    findings.pop();
    coverage.findings.included = findings.length;
    json = JSON.stringify(render());
  }
  while (json.length > ANALYST_EVIDENCE_MAX_CHARS && pruneTrustGraphPacket(packet)) {
    json = JSON.stringify(render());
  }
  while (json.length > ANALYST_EVIDENCE_MAX_CHARS) {
    const section = pruneOrder.find((key) => protectedEvidenceSections.has(key) && Array.isArray(packet[key]) && packet[key].length > 0);
    if (!section) break;
    packet[section].pop();
    coverage[section].included = packet[section].length;
    json = JSON.stringify(render());
  }
  while (json.length > ANALYST_EVIDENCE_MAX_CHARS && findings.length > 0) {
    findings.pop();
    coverage.findings.included = findings.length;
    json = JSON.stringify(render());
  }
  if (json.length > ANALYST_EVIDENCE_MAX_CHARS && packet.profile != null) {
    delete packet.profile;
    json = JSON.stringify(render());
  }
  if (json.length > ANALYST_EVIDENCE_MAX_CHARS) {
    throw new Error(`analyst evidence packet exceeds ${ANALYST_EVIDENCE_MAX_CHARS} characters after structural pruning`);
  }
  return json;
}
function buildScoringEvidencePacket(input, axisCatalog2) {
  return serializeAnalystEvidencePacket(input, { includeInvestigativeLeads: false, axisCatalog: axisCatalog2 });
}
async function analyzeSubject(handle, roles, axisCatalog2, evidenceJson, options = {}) {
  const axisNames = axisCatalog2.map(({ axis }) => axis);
  if (!axisCatalog2.length || new Set(axisNames).size !== axisNames.length || axisCatalog2.some((axis) => !axis.axis || !Number.isInteger(axis.weight) || axis.weight < 0)) return null;
  const evidenceCatalog = extractScoringEvidenceCatalog(evidenceJson);
  if (!evidenceCatalog.length || axisCatalog2.some((axis) => !evidenceCatalog.some((artifact) => isSubstantiveArtifact(artifact) && artifact.eligibleAxes.includes(axis.axis)))) return null;
  const citationAliases = evidenceCatalog.map((artifact, index) => ({
    alias: `e${String(index + 1).padStart(3, "0")}`,
    artifact
  }));
  const citationAliasTable = citationAliases.map(({ alias, artifact }) => `${alias} = ${artifact.artifactId}`).join("\n");
  const system = "You are ARGUS, a forensic crypto due-diligence analyst. You score a subject on a fixed set of axes from collected evidence only. Be skeptical: a strong story never papers over a disqualifying fact. Score conservatively when evidence is thin. Each axis score must be between 0 and its weight. Write one tight rationale per axis citing the evidence. Never use em dashes.";
  const user = `Subject: ${handle}
Held roles: ${roles.join(", ")}

Axes to score (axis | weight | role):
` + axisCatalog2.map((a) => `- ${a.axis} | max ${a.weight} | ${a.role}`).join("\n") + `

Collected evidence (JSON):
${evidenceJson}

Citation aliases (return these short aliases in the tool call; ARGUS maps them back to the exact immutable artifact IDs):
${citationAliasTable}

Score every listed axis, write the composite headline (one sentence on what governs the verdict), and an identity note.

ACTIVITY RULE: weigh posting cadence. profile.days_since_post is how long the account has been silent. For a PROJECT/token, going quiet for weeks (roughly 21+ days) is a real liveness flag (abandoned, winding down, or quiet after a raise) and should temper traction/execution axes; for an individual it is a milder signal. Recent, steady posting is mildly positive, not a free pass.

IDENTITY RULE: if the evidence has a "team" array of named people tied to the project (especially any with a LinkedIn, or a named founder/CEO/CTO), the project's real-world identity is RESOLVED. A pseudonymous brand/company handle run on behalf of a publicly named team is NORMAL and is NOT an anonymity red flag: do not score identity/backing axes as if the operators were anonymous, and do NOT write a headline that calls the founder identity "unresolved", "unnamed", or "anonymous" when named leaders are present. Only treat identity as unresolved when the evidence genuinely names no one behind the project.

PROFILE PHOTO RULE: profileAuthenticity is a visual-integrity triage screen, not identity proof. A real-looking photo never establishes who operates the account, and an AI, stock, celebrity, logo, cartoon, unclear, or missing photo never establishes impersonation by itself. Use it only as a review lead.

INVESTIGATIVE LEAD EXCLUSION: investigative leads are excluded from this scoring packet. Do not infer anything about the subject from their absence. Use all remaining collected evidence according to its provenance and verification state.

FINDING ATTRIBUTION RULE: when comparing or interpreting finding collections, only direct-subject findings may be attributed to the audited subject. A relationship alone is not evidence of participation or responsibility. This restriction applies to finding collections, not to legitimate non-finding evidence: profile, team, wallet, check-outcome, source, and provider evidence may affect scoring when relevant and reliable.

CITATION RULE: return exactly one array row for every requested axis. The axis field must exactly match an ID in the requested axis list and score must be an integer from zero through that axis's listed maximum. primaryEvidenceRef must be one substantive alias eligible for that axis. additionalEvidenceRefs contains zero to seven other substantive aliases, without duplicates. Always return coverageRefs, using an empty array when none apply; it may contain zero to four checked-empty or unavailable aliases eligible for that axis, and if any are returned, gaps must include a material missing-coverage description. counterEvidenceRefs contains zero to eight substantive aliases that credibly pull against the score. Never repeat an alias or place it on both sides. gaps contains zero to six short descriptions of material unresolved evidence. providerRuns operational telemetry is excluded from the scoring packet and must never be inferred or cited.

TRUST GRAPH RULE: only qualified connections and structured TrustGraphConnection findings bound to an exact complete server-collected report may influence scoring. Weak or unqualified ties are context only. ARGUS applies any graph cap deterministically after your axis scoring; do not invent or strengthen one.`;
  const tool = {
    name: "record_verdict",
    description: "Record one complete forensic score row for every requested axis, plus a composite headline and identity note. Coverage-only citations belong only in coverageRefs and require a material missing-coverage gap when any are returned; they never count as substantive support or counter-evidence. Every declared field must be returned, even when an array is empty. ARGUS deterministically validates the exact axis set, score bounds, and citation eligibility before accepting the result.",
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
  let validated = validateAnalystVerdict(
    raw,
    axisCatalog2,
    evidenceCatalog,
    (reason) => {
      rejectionReason = reason;
    }
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
    const repairUser = `${user}

REPAIR REQUIRED: the prior record_verdict tool payload was rejected by deterministic validation with reason "${rejectionReason}". Make one fresh record_verdict call. Recheck the exact axis set, per-axis score bounds, citation eligibility, duplicate aliases, support/counter overlap, and the array limits (seven additional support, eight counter, four coverage, and six gaps), plus the requirement that any returned coverageRefs have a material gap description. Do not invent evidence or fill a missing fact.`;
    raw = await structured(
      system,
      repairUser,
      tool,
      6e3,
      ANALYST_REPAIR_TIMEOUT_MS
    );
    rejectionReason = "unknown";
    validated = validateAnalystVerdict(
      raw,
      axisCatalog2,
      evidenceCatalog,
      (reason) => {
        rejectionReason = reason;
      }
    );
    if (raw && !validated) {
      console.warn(`[agent] rejected analyst repair axis set (${rejectionReason})`);
    }
  }
  return validated;
}

// src/lib/scanChecklist.ts
var SUCCESSFUL = /* @__PURE__ */ new Set(["confirmed", "finding", "checked-empty"]);
var UNKNOWN_OR_FAILED = /* @__PURE__ */ new Set(["unknown", "unavailable", "stale"]);
function summarizeChecks(checks) {
  const count = (status) => checks.filter((check) => check.status === status).length;
  const notApplicable = count("not-applicable");
  return {
    total: checks.length,
    inScope: checks.length - notApplicable,
    successful: checks.filter((check) => SUCCESSFUL.has(check.status)).length,
    unknownOrFailed: checks.filter((check) => UNKNOWN_OR_FAILED.has(check.status)).length,
    findings: count("finding"),
    checkedEmpty: count("checked-empty"),
    notApplicable,
    unavailable: count("unavailable"),
    stale: count("stale"),
    unknown: count("unknown")
  };
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
  checks.push(roles.includes("INVESTOR") ? { label: "VC portfolio track record", status: "unknown", note: `eligible by role; ${outcomeNotRecorded}` } : { label: "VC portfolio track record", status: "not-applicable", note: "not a fund/investor" });
  checks.push({ label: "News & press", status: "unknown", note: outcomeNotRecorded });
  checks.push(resolved && realName ? { label: "US legal history", status: "unknown", note: `eligible by resolved name; ${outcomeNotRecorded}` } : { label: "US legal history", status: "not-applicable", note: "needs a resolved real name" });
  checks.push(resolved && realName ? { label: "OFAC sanctions (name)", status: "unknown", note: `eligible by resolved name; ${outcomeNotRecorded}` } : { label: "OFAC sanctions (name)", status: "not-applicable", note: "needs a resolved real name" });
  checks.push({ label: "Trust-graph connections", status: "unknown", note: `ties to other audited subjects; ${outcomeNotRecorded}` });
  return checks;
}

// server/checks.ts
var CHECKS = [
  { id: "identity-resolution", label: "Identity resolution", defaultNote: "no completed server-side identity resolution was recorded" },
  { id: "profile-photo-authenticity", label: "Profile-photo integrity", defaultNote: "server collector did not run a profile-photo integrity screen" },
  { id: "code-footprint-github", label: "Code footprint (GitHub)", defaultNote: "no completed GitHub resolution was recorded" },
  { id: "identity-continuity", label: "Identity continuity", defaultNote: "no completed handle-history result was recorded" },
  { id: "affiliations-associates", label: "Affiliations & associates", defaultNote: "no corroborated affiliation collection outcome was recorded" },
  { id: "promoted-token-performance", label: "Promoted-token performance", defaultNote: "no completed promoted-token market result was recorded", role: "KOL" },
  { id: "vc-portfolio-track-record", label: "VC portfolio track record", defaultNote: "no completed portfolio-provider result was recorded", role: "INVESTOR" },
  { id: "news-press", label: "News & press", defaultNote: "server collector did not run a news/press check" },
  { id: "us-legal-history", label: "US legal history", defaultNote: "server collector did not run a legal-history check", requiresResolvedRealName: true },
  { id: "ofac-sanctions-name", label: "OFAC sanctions (name)", defaultNote: "server collector did not run a name-sanctions check", requiresResolvedRealName: true },
  { id: "trust-graph-connections", label: "Trust-graph connections", defaultNote: "server collector did not run flagged-subject graph reconciliation" }
];
var PERSON_CHECK_IDS = Object.freeze(CHECKS.map((check) => check.id));
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
    const normalized = {
      ...observation,
      note: observation.note.trim(),
      provider: observation.provider.trim(),
      sourceCount: observation.sourceCount == null ? void 0 : Math.max(0, Math.floor(observation.sourceCount)),
      completedAt: iso(observation.completedAt)
    };
    if (!normalized.note || !normalized.provider) return;
    const current = this.observations.get(normalized.id) ?? [];
    this.observations.set(normalized.id, uniqueObservations([...current, normalized]));
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
    return CHECKS.map((definition) => {
      if (definition.role && !heldRoles.has(definition.role)) {
        return Object.freeze({
          checkId: definition.id,
          label: definition.label,
          status: "not-applicable",
          note: definition.role === "KOL" ? "not a KOL" : "not a fund/investor"
        });
      }
      if (definition.requiresResolvedRealName && scope.resolvedRealName === false) {
        return Object.freeze({
          checkId: definition.id,
          label: definition.label,
          status: "not-applicable",
          note: "requires a resolved real-person name"
        });
      }
      const observations = this.observations.get(definition.id) ?? [];
      if (!observations.length) {
        return Object.freeze({
          checkId: definition.id,
          label: definition.label,
          status: "unknown",
          note: definition.defaultNote
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
        provider: providers.join(","),
        ...sourceCount > 0 ? { sourceCount } : {},
        ...completedAt ? { completedAt } : {}
      });
    });
  }
  completeness(roles, scope = {}) {
    const summary = summarizeChecks(this.snapshot(roles, scope));
    return summary.inScope > 0 && summary.successful === summary.inScope ? "complete" : "partial";
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
var asRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
var optionalNumber = (value) => typeof value === "number" && Number.isFinite(value) ? value : void 0;
async function grokSearch(system, user, opts) {
  const key = env("XAI_API_KEY");
  if (!key) return null;
  if (opts?.cacheKey) {
    const hit = await cacheGet(opts.cacheKey);
    if (hit) return hit;
  }
  const call = async (withCap) => {
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
      d = asRecord(await res.json());
    } catch {
      addGrokUsage(void 0, 0, "live-search", "failed", "response_json_error");
      return { status: res.status, text: null };
    }
    const output = Array.isArray(d.output) ? d.output.map(asRecord) : [];
    const toolCalls = output.length ? output.filter((item) => /search|tool/.test(String(item.type ?? ""))).length : void 0;
    const usageRecord = asRecord(d.usage);
    const usage = {
      input_tokens: optionalNumber(usageRecord.input_tokens),
      output_tokens: optionalNumber(usageRecord.output_tokens),
      num_sources_used: optionalNumber(usageRecord.num_sources_used)
    };
    const nestedText = output.flatMap((item) => Array.isArray(item.content) ? item.content.map(asRecord) : []).map((content) => typeof content.text === "string" ? content.text : "").join(" ");
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
  if (result.status === 400) result = await call(false);
  if (result.text && opts?.cacheKey) void cacheSet(opts.cacheKey, result.text);
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
        const payload = asRecord(await res.clone().json());
        const providerError = payload.status === "error" || payload.data === null;
        recordTwitterapi(op, providerError ? "failed" : "succeeded", providerError ? "provider_error_envelope" : void 0);
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
  const envelope = asRecord(parsed);
  if (!Array.isArray(envelope.accounts)) {
    recordCall("memory.lol", "tw-history", 0, "invalid_result_shape", "partial");
    return null;
  }
  if (!envelope.accounts.length) {
    recordCall("memory.lol", "tw-history", 0, "no_match", "succeeded");
    return { priorHandles: [] };
  }
  const acct = asRecord(envelope.accounts[0]);
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
var KW_IDENTITY = ["founder", "co-founder", "cofounder", "CEO", "CTO", "advisor", '"I built"', '"we built"', '"joined as"', "founded"];
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
  if (!key) return { list: [], checked: 0 };
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
  const deadline = Date.now() + (opts?.budgetMs ?? 45e3);
  let checked = 0;
  for (let i = 0; i < toCheck.length; i += CHUNK) {
    if (Date.now() > deadline) break;
    const slice = toCheck.slice(i, i + CHUNK);
    const res = await Promise.all(
      slice.map(async (n) => {
        const rel = await checkFollow(n.handle, subject);
        return rel?.following ? { handle: n.handle, label: n.label, size: "" } : null;
      })
    );
    checked += slice.length;
    for (const r of res) if (r) hits.push(r);
  }
  return { list: hits, checked };
}
async function acknowledgments(endorsers, subject) {
  const out = /* @__PURE__ */ new Map();
  const key = env("XAI_API_KEY");
  const list = [...new Set(endorsers.map((e) => e.replace(/^@/, "")).filter(Boolean))];
  if (!key || !list.length) return out;
  const s = subject.replace(/^@/, "");
  const system = "You generate endorsement-verification leads for a due-diligence collector, with live web and X search. For EACH listed account, surface the strongest candidate public acknowledgment that account may have made of @" + s + ' on X, its sentiment, and the exact post URL. This is discovery only: do not call a relationship corroborated or contradicted. Without a direct post URL, return ack=none and sentiment=none. ack is one of none|mention|thanks|endorsement; sentiment is positive|neutral|negative|none. Reply with ONLY compact JSON: {"results":[{"handle":"@...","ack":"none|mention|thanks|endorsement","sentiment":"positive|neutral|negative|none","source_url":"https://x.com/.../status/..."}]} \u2014 one entry per listed account, never invent posts.';
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
  const aliasLine = oldHandles.length ? ` This SAME person previously used these X handles: ${oldHandles.map((o) => "@" + o).join(", ")} \u2014 search posts mentioning those old handles too.` : "";
  const system = `You are a forensic due-diligence researcher with live web and X search. Find EVERY company, crypto project, fund, DAO, or venture that THIS SPECIFIC person (the holder of the given X account) is publicly tied to in ANY working capacity: founded, co-founded, led, was an early employee of, worked at, contributed to, was a core team member of, or advised. Work BOTH angles: (1) what the person's own footprint shows \u2014 accelerator/portfolio pages, press, team pages, GitHub orgs, podcasts, Crunchbase, beyond their bio and LinkedIn; (2) reverse mentions \u2014 project/company accounts that ever NAMED, TAGGED, or ANNOUNCED this person as a founder/team member (co-founder announcements and 'meet the team' posts are often YEARS old, on the project's timeline, search historical posts). There MUST be public evidence tying THAT EXACT person to the venture. For each, also report the venture's own X handle and website domain if you can find them. Reply with ONLY compact JSON: {"affiliations":[{"name":"","role":"founder|cofounder|exec|employee|engineer|contributor|advisor|affiliate","year":"","evidence":"one short source phrase","x_handle":"@...","domain":"example.com"}]}. Include ONLY affiliations you found real, attributable evidence for. If you cannot confidently tie a venture to THIS person, omit it. If you find nothing, return {"affiliations":[]}. NEVER invent, guess, or include a venture just because the name is common. Never use em dashes.`;
  const text2 = await grokSearch(system, `Person: ${name || h} (X handle @${h}).${aliasLine} Every company or project they have founded, led, worked at, contributed to, or advised, however small the role \u2014 from their own footprint AND from project accounts announcing them. Be exhaustive: a serial operator often has 5-15 ventures across years; keep searching until you have run down every lead. Search the web and X including historical posts.`, { maxToolCalls: 10, cacheKey: `affil:${h}:${oldHandles.join(",")}` });
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
  const system = `You are a forensic researcher with live X search. Identify the PEOPLE publicly tied to the project behind the given X account: founders, cofounders, core team, engineers, AND advisors/backers. Look especially at the account's OWN posts (team intros, 'welcome @x as our CTO', 'our founder @y', 'advised by @z', 'backed by @w') and posts that tag these people, plus posts mentioning the project that name its people. Be PRECISE about each person's role AT THIS project: only call someone an advisor if they are actually named as one; if they are a founder/cofounder, say so \u2014 do NOT downgrade a founder to advisor. For EACH person also list their OTHER notable projects or companies (name + their role there, e.g. founder/cofounder/advisor/engineer) that live web/X search reveals \u2014 this exposes serial founders and cross-project ties. Include ONLY people with real public evidence tying them to THIS project. EXCLUDE the project account itself, generic shillers, hype repliers, and unrelated mentions. Reply with ONLY compact JSON: {"people":[{"name":"","handle":"@...","linkedin":"linkedin.com/in/...","role":"founder|cofounder|ceo|cto|engineer|advisor|backer","kind":"team|advisor","evidence":"","projects":[{"name":"","role":""}]}]}. If none, return {"people":[]}. NEVER invent. Never use em dashes.`;
  const text2 = await grokSearch(system, `X account: @${h}${name && name !== h ? ` (${name})` : ""}. Who are the founders, team members, and advisors of this project? Give each person's precise role here AND their other projects. Search the account's own posts and posts mentioning it.${postContext}`, { cacheKey: `team-x:${h}` });
  return parseTeamJSON(text2, h, "X content");
}
async function findTeamOnSite(domain, projectName) {
  const clean = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
  if (!clean && !projectName) return [];
  const anchor = clean ? `website ${clean}${projectName ? ` (${projectName})` : ""}` : `project "${projectName}"`;
  const system = `You are a forensic OSINT researcher with live web and X search. Find EVERY real person behind the crypto/tech project: founders, cofounders, the WHOLE leadership team (CEO/CTO/COO/CFO/CMO), engineering and product leads, AND advisors/backers. DIG hard and be COMPLETE: Google the project + 'team'/'leadership'/'about', open the project's LinkedIn company page and read its 'People' tab (list the employees it shows), check Crunchbase people, the GitHub org's members, podcasts/interviews/press, and X. For an established project expect to name SEVERAL people \u2014 do NOT stop at one or two; keep going until you have the full public roster you can verify. Connect each name to their X handle and LinkedIn where possible. Include ONLY real people genuinely tied to THIS specific project (match the domain/name; do not confuse same-named projects). EXCLUDE hype/shill accounts and generic mentions. Be PRECISE about each person's role AT THIS project: only call someone an advisor if the project actually names them as one; if the site/LinkedIn shows them as a founder/cofounder/CEO, use THAT \u2014 do NOT downgrade a founder to advisor. For EACH person, also list their OTHER notable projects/companies (name + their role there) that web/LinkedIn/Crunchbase reveal \u2014 this exposes serial founders and cross-project ties. Reply with ONLY compact JSON: {"people":[{"name":"","handle":"@...","linkedin":"linkedin.com/in/...","role":"","kind":"team|advisor","evidence":"","projects":[{"name":"","role":""}]}]}. If nobody, {"people":[]}. NEVER invent. Never use em dashes.`;
  const text2 = await grokSearch(system, `Crypto/tech ${anchor}. Find the COMPLETE public team: every founder, executive, core team member, and advisor behind it. Read its LinkedIn company People tab, Crunchbase, GitHub org, and press. Connect each to their X handle and LinkedIn, give each person's PRECISE role here, AND list their other projects. Name as many verifiable people as you can, not just the most famous one.`, { cacheKey: `team-site:${clean || projectName}` });
  return parseTeamJSON(text2, void 0, clean ? "web/LinkedIn search" : "web/LinkedIn (by name)");
}
async function enrichTeamIdentities(project, people) {
  if (!people.length) return [];
  const system = `You are an OSINT researcher with live web and X search. For each named team member of the given project, find their X (Twitter) handle and LinkedIn profile. Match the RIGHT person: same name + same project/role (check bios, the project's follows, press). If you cannot confidently match one, omit that field rather than guess. Reply with ONLY compact JSON: {"people":[{"name":"","handle":"@...","linkedin":"linkedin.com/in/..."}]} \u2014 one entry per input name, fields omitted when unknown. NEVER invent. Never use em dashes.`;
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
function parseTeamJSON(text2, selfHandle, source) {
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
        source,
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
    const haveOfficialAvatar = ctx.evidence.profile.avatar_source_state != null;
    const prof = haveProfile && haveOfficialAvatar ? null : await getProfile2(ctx.handle);
    if (prof) {
      ctx.evidence.profile.profile_collection_state = "resolved";
      ctx.evidence.profile.profile_provider = "twitterapi";
      ctx.evidence.profile.profile_captured_at = (/* @__PURE__ */ new Date()).toISOString();
      ctx.evidence.profile.display_name = prof.name ?? ctx.evidence.profile.display_name;
      ctx.evidence.profile.bio = prof.bio ?? ctx.evidence.profile.bio;
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
      ctx.emit({ phase: "P0 \xB7 Intake", label: dormant ? "Dormant account" : "Active", detail: dormant ? `No posts in ${days} days \u2014 a project or account gone quiet is a liveness flag.` : `Last posted ${days === 0 ? "today" : days === 1 ? "yesterday" : days + " days ago"}.`, source: "twitterapi.io", tone: dormant ? "warn" : "good" });
    }
    if (!ctx.evidence.notableFollowers.length) {
      ctx.emit({ phase: "P0 \xB7 Intake", label: "Notable followers", detail: "Checking which top funds, founders, and KOLs follow the subject\u2026", source: "twitterapi.io", tone: "neutral" });
      const fcm = (ctx.evidence.profile.followers ?? "").match(/([\d.]+)\s*([KMB]?)/i);
      const followerCount = fcm ? Number(fcm[1]) * (/m/i.test(fcm[2]) ? 1e6 : /b/i.test(fcm[2]) ? 1e9 : /k/i.test(fcm[2]) ? 1e3 : 1) : void 0;
      const scan = await notableFollowers(ctx.handle, { followerCount, organizationId: ctx.organizationId });
      const nf = scan.list;
      ctx.evidence.notableFollowers = nf;
      if (nf.length) {
        ctx.emit({ phase: "P0 \xB7 Intake", label: "Notable followers", detail: `Followed by ${nf.length} of ${scan.checked} known accounts checked: ${nf.slice(0, 8).map((n) => `@${n.handle}${n.label ? ` (${n.label})` : ""}`).join(", ")}${nf.length > 8 ? ", \u2026" : ""}.`, source: "twitterapi.io", tone: "good" });
      } else {
        ctx.emit({ phase: "P0 \xB7 Intake", label: "Notable followers", detail: `None of the ${scan.checked} known funds/founders/KOLs checked follow this subject.`, source: "twitterapi.io", tone: "neutral" });
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
function htmlToText(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
}
async function fetchPage(url) {
  let response;
  try {
    response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; ARGUS/1.0)", accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(8e3) });
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

// server/adapters/sitecheck.ts
var COMING = /coming[\s_-]*soon|under[\s_-]*construction|launching[\s_-]*soon|join[\s_-]*(the[\s_-]*)?waitlist|\bwaitlist\b|early[\s_-]*access|get[\s_-]*notified|notify[\s_-]*me|be[\s_-]*the[\s_-]*first|request[\s_-]*access|sign[\s_-]*up[\s_-]*for[\s_-]*(early[\s_-]*)?access/i;
var PARKED = /this[\s_-]*domain[\s_-]*is[\s_-]*for[\s_-]*sale|buy[\s_-]*this[\s_-]*domain|hugedomains|sedoparking|parkingcrew|domain[\s_-]*(is[\s_-]*)?parked/i;
var PRODUCT = /\b(docs|whitepaper|dashboard|pricing|features|roadmap|marketplace|explorer|portfolio|order\s*book|connect\s*wallet|launch\s*app|sign\s*in|log\s*in|deposit|withdraw|governance|staking)\b/i;
function stripText(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}
async function get(url, opts) {
  let response;
  try {
    response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; ARGUS/1.0)", accept: "text/html,application/javascript" }, redirect: "follow", signal: AbortSignal.timeout(8e3) });
  } catch {
    recordCall("site-fetch", "substance", 0, "transport_error", "failed");
    return null;
  }
  if (!response.ok) {
    recordCall("site-fetch", "substance", 0, `http_${response.status}`, "failed");
    return null;
  }
  if ((opts?.requireHtml ?? true) && !/html/i.test(response.headers.get("content-type") ?? "")) {
    recordCall("site-fetch", "substance", 0, "unexpected_content_type", "partial");
    return null;
  }
  let html;
  try {
    html = await response.text();
  } catch {
    recordCall("site-fetch", "substance", 0, "response_text_error", "failed");
    return null;
  }
  if (!html.trim()) {
    recordCall("site-fetch", "substance", 0, "empty_body", "partial");
    return null;
  }
  recordCall("site-fetch", "substance", 0, void 0, "succeeded");
  return { url: response.url || url, html };
}
function bundleUrls(html, base) {
  const out = [];
  const re = /<script[^>]+src=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) && out.length < 3) {
    const src = m[1];
    if (/\.js(\?|$)/i.test(src) && !/googletagmanager|gtag|analytics|hotjar|intercom|segment|cdn\.jsdelivr|unpkg/i.test(src)) {
      try {
        out.push(new URL(src, base).href);
      } catch {
      }
    }
  }
  return out;
}
async function checkSiteSubstance(domain) {
  const d = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase().trim();
  if (!d || !/\.[a-z]{2,}$/i.test(d)) return null;
  const page = await get(`https://${d}`) || await get(`https://www.${d}`);
  if (!page) return { url: `https://${d}`, status: "unreachable", detail: "the site does not resolve or returns no page" };
  const meta = page.html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? "";
  const body = stripText(page.html);
  if (PARKED.test(page.html)) return { url: page.url, status: "coming_soon", detail: "the domain is parked / for sale, not a live project site" };
  if (COMING.test(body) || COMING.test(meta)) return { url: page.url, status: "coming_soon", detail: `the homepage is a coming-soon / waitlist page${meta ? ` ("${meta.slice(0, 80)}")` : ""}` };
  if (body.length >= 400 && PRODUCT.test(body)) return { url: page.url, status: "live", detail: `live site${meta ? ` \u2014 "${meta.slice(0, 80)}"` : ""}` };
  const isShell = /id=["'](root|__next|app|__nuxt)["']/i.test(page.html) || /<script[^>]+type=["']module["']/i.test(page.html);
  if (isShell && body.length < 300) {
    for (const b of bundleUrls(page.html, page.url)) {
      const js = await get(b, { requireHtml: false }).catch(() => null);
      const text2 = js?.html ?? "";
      if (!text2) continue;
      if (COMING.test(text2) || /ComingSoon|Waitlist|EarlyAccess|UnderConstruction/i.test(text2)) {
        return { url: page.url, status: "coming_soon", detail: `the live site is a coming-soon / waitlist page (client-rendered${meta ? `, "${meta.slice(0, 60)}"` : ""})` };
      }
    }
    return { url: page.url, status: "client_rendered", detail: `client-rendered app; static read couldn't confirm a live product surface${meta ? ` ("${meta.slice(0, 80)}")` : ""}` };
  }
  return { url: page.url, status: "live", detail: `site is up${meta ? ` \u2014 "${meta.slice(0, 80)}"` : ""}` };
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
          detail: `liquidity $${Math.round(canon.liquidityUsd).toLocaleString()}${canon.h24 != null ? `, ${Math.round(canon.h24)}% 24h` : ""}${nearZeroLiq ? " \u2014 effectively dead" : ""}`
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
        detail: `liquidity $${Math.round(snap.liquidityUsd ?? 0).toLocaleString()}, 24h vol $${Math.round(snap.volume24h ?? 0).toLocaleString()}${thin ? " \u2014 thin liquidity, rug-risk flag" : ""}`,
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

// server/adapters/peopledatalabs.ts
var BASE2 = "https://api.peopledatalabs.com/v5";
var asRecord2 = (value) => value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
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
  const payload = asRecord2(raw);
  if (!payload || !("data" in payload)) {
    recordPdlMatch(false, "partial", "missing_data");
    return null;
  }
  if (payload.data == null) {
    recordPdlMatch(false, "succeeded", "no_match");
    return null;
  }
  const p = asRecord2(payload.data);
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
    const x = asRecord2(value);
    if (!x) {
      issues.push("invalid_experience_item");
      return [];
    }
    const company = asRecord2(x.company);
    const title = asRecord2(x.title);
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
    ...Array.isArray(p.emails) ? p.emails.map((email) => typeof email === "string" ? email : asRecord2(email)?.address) : []
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
  const clean = path.split("?")[0];
  if (clean === "/search/users") return isRecord2(value) && Array.isArray(value.items);
  if (/^\/users\/[^/]+\/(orgs|repos)$/.test(clean)) return Array.isArray(value);
  if (/^\/users\/[^/]+$/.test(clean)) return isRecord2(value) && typeof value.login === "string" && !!value.login.trim();
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

// server/adapters/crunchbase.ts
var BASE3 = "https://api.crunchbase.com/api/v4";
async function lookupOrganization(name) {
  const key = env("CRUNCHBASE_API_KEY");
  if (!key) return null;
  const meta = "plan-billed";
  let res;
  try {
    res = await fetch(`${BASE3}/searches/organizations`, {
      method: "POST",
      headers: { "X-cb-user-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        field_ids: ["identifier", "funding_total", "num_funding_rounds", "investor_identifiers", "acquirer_identifier"],
        query: [{ type: "predicate", field_id: "identifier", operator_id: "contains", values: [name] }],
        limit: 1
      }),
      signal: AbortSignal.timeout(12e3)
    });
  } catch {
    recordCall("crunchbase", "org-search", 0, `${meta} \xB7 transport_error`, "failed");
    return null;
  }
  if (!res.ok) {
    recordCall("crunchbase", "org-search", 0, `${meta} \xB7 http_${res.status}`, "failed");
    return null;
  }
  let d;
  try {
    d = await res.json();
  } catch {
    recordCall("crunchbase", "org-search", 0, `${meta} \xB7 response_json_error`, "failed");
    return null;
  }
  if (!d || typeof d !== "object" || !Array.isArray(d.entities)) {
    recordCall("crunchbase", "org-search", 0, `${meta} \xB7 result_shape_error`, "partial");
    return null;
  }
  if (!d.entities.length) {
    recordCall("crunchbase", "org-search", 0, `${meta} \xB7 no_match`, "succeeded");
    return null;
  }
  const e = d.entities[0]?.properties;
  const resolvedName = e?.identifier?.value;
  if (!e || typeof e !== "object" || typeof resolvedName !== "string" || !resolvedName.trim()) {
    recordCall("crunchbase", "org-search", 0, `${meta} \xB7 result_shape_error`, "partial");
    return null;
  }
  const rawInvestors = e.investor_identifiers;
  const investorShapeOkay = rawInvestors == null || Array.isArray(rawInvestors);
  const investors = (Array.isArray(rawInvestors) ? rawInvestors : []).map((investor) => investor?.value).filter((value) => typeof value === "string" && !!value.trim());
  recordCall(
    "crunchbase",
    "org-search",
    0,
    investorShapeOkay ? meta : `${meta} \xB7 incomplete_investor_shape`,
    investorShapeOkay ? "succeeded" : "partial"
  );
  return {
    name: resolvedName,
    fundingTotal: e.funding_total?.value_usd,
    rounds: e.num_funding_rounds,
    investors,
    acquirer: e.acquirer_identifier?.value
  };
}
var crunchbaseAdapter = {
  id: "crunchbase",
  label: "Crunchbase",
  available: () => !!env("CRUNCHBASE_API_KEY"),
  async run(ctx) {
    if (!ctx.evidence.ventures.length) return;
    ctx.emit({ phase: "Founder", label: "Verify funding", detail: `Cross-referencing ${ctx.evidence.ventures.length} venture(s) against Crunchbase\u2026`, tone: "neutral" });
    let matched = 0;
    for (const v of ctx.evidence.ventures) {
      const org = await lookupOrganization(v.project_name);
      if (!org) {
        ctx.emit({ phase: "Founder", label: v.project_name, detail: "no Crunchbase record found for claimed venture", source: "crunchbase", tone: "warn" });
        continue;
      }
      matched += 1;
      if (org.investors?.length) v.investors = Array.from(/* @__PURE__ */ new Set([...v.investors ?? [], ...org.investors]));
      if (org.acquirer && !v.acquirer) v.acquirer = org.acquirer;
      ctx.emit({ phase: "Founder", label: v.project_name, detail: `verified \xB7 ${org.rounds ?? 0} rounds, backers: ${(org.investors ?? []).slice(0, 3).join(", ") || "n/a"}`, source: "crunchbase", tone: "good" });
    }
    if (matched) {
      ctx.recordCheck?.({
        id: "vc-portfolio-track-record",
        status: "confirmed",
        note: `${matched} claimed venture${matched === 1 ? "" : "s"} matched to Crunchbase records`,
        provider: "crunchbase",
        sourceCount: matched
      });
    } else {
      ctx.recordCheck?.({
        id: "vc-portfolio-track-record",
        status: "checked-empty",
        note: `Crunchbase lookup completed for ${ctx.evidence.ventures.length} claimed venture${ctx.evidence.ventures.length === 1 ? "" : "s"} without a matching record`,
        provider: "crunchbase"
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
        detail: `mcap $${Math.round(t.mcapUsd ?? 0).toLocaleString()}${downBad ? `, ${Math.round(t.ath_change_pct)}% from ATH \u2014 collapsed` : ""}`,
        source: "coingecko",
        tone: downBad ? "warn" : "neutral"
      });
    }
  }
};

// server/adapters/reddit.ts
var cachedToken = null;
var asRecord3 = (value) => value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
function recordRedditAttempt(op, status, meta) {
  recordCall("reddit", op, 0, meta, status);
}
async function getToken() {
  const id = env("REDDIT_CLIENT_ID");
  const secret = env("REDDIT_CLIENT_SECRET");
  if (!id || !secret) return null;
  if (cachedToken && cachedToken.exp > Date.now()) return cachedToken.token;
  let res;
  try {
    res = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": "argus-dd/1.0"
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(8e3)
    });
  } catch {
    recordRedditAttempt("oauth-token", "failed", "transport_error");
    return null;
  }
  if (!res.ok) {
    recordRedditAttempt("oauth-token", "failed", `http_${res.status}`);
    return null;
  }
  let raw;
  try {
    raw = await res.json();
  } catch {
    recordRedditAttempt("oauth-token", "failed", "response_json_error");
    return null;
  }
  const d = asRecord3(raw);
  const token = typeof d?.access_token === "string" && d.access_token ? d.access_token : null;
  if (!token) {
    recordRedditAttempt("oauth-token", "partial", "missing_access_token");
    return null;
  }
  const expiresIn = typeof d?.expires_in === "number" && Number.isFinite(d.expires_in) ? d.expires_in : null;
  if (expiresIn == null) {
    recordRedditAttempt("oauth-token", "partial", "missing_expiry");
    return token;
  }
  cachedToken = { token, exp: Date.now() + (expiresIn - 60) * 1e3 };
  recordRedditAttempt("oauth-token", "succeeded");
  return token;
}
async function searchMentions(query) {
  const token = await getToken();
  if (!token) return [];
  let res;
  try {
    res = await fetch(`https://oauth.reddit.com/search?q=${encodeURIComponent(query)}&sort=relevance&limit=15&t=year`, {
      headers: { authorization: `Bearer ${token}`, "user-agent": "argus-dd/1.0" },
      signal: AbortSignal.timeout(1e4)
    });
  } catch {
    recordRedditAttempt("search", "failed", "transport_error");
    return [];
  }
  if (!res.ok) {
    recordRedditAttempt("search", "failed", `http_${res.status}`);
    return [];
  }
  let raw;
  try {
    raw = await res.json();
  } catch {
    recordRedditAttempt("search", "failed", "response_json_error");
    return [];
  }
  const d = asRecord3(raw);
  const data = asRecord3(d?.data);
  if (!Array.isArray(data?.children)) {
    recordRedditAttempt("search", "partial", "missing_children");
    return [];
  }
  let invalidChildren = 0;
  const hits = data.children.flatMap((child) => {
    const item = asRecord3(asRecord3(child)?.data);
    const title = typeof item?.title === "string" ? item.title : null;
    const sub = typeof item?.subreddit_name_prefixed === "string" ? item.subreddit_name_prefixed : null;
    const permalink = typeof item?.permalink === "string" ? item.permalink : null;
    if (!title || !sub || !permalink) {
      invalidChildren += 1;
      return [];
    }
    return [{
      title,
      sub,
      score: typeof item?.score === "number" && Number.isFinite(item.score) ? item.score : 0,
      url: "https://reddit.com" + permalink
    }];
  });
  recordRedditAttempt(
    "search",
    invalidChildren ? "partial" : "succeeded",
    invalidChildren ? `dropped_${invalidChildren}_invalid_results` : `${hits.length}_results`
  );
  return hits;
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
        source_author: "reddit",
        verification_status: "Reported",
        independent_source_count: 1,
        polarity: -1,
        provider: "reddit",
        evidence_origin: "deterministic",
        artifact_verified: true,
        finding_scope: {
          scope: "direct_subject",
          target_entity_key: ctx.evidence.profile.handle,
          target_entity_type: "person",
          relationship_to_subject: "self",
          relationship_label: "Reddit search result naming the audited handle"
        }
      });
    }
    ctx.emit({ phase: "Reputation", label: `${hits.length} threads`, detail: `Top: "${hits[0].title.slice(0, 70)}" (${hits[0].sub})`, source: "reddit", tone: hits.length > 3 ? "warn" : "neutral" });
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

// server/adapters/offchain.ts
import { createHash as createHash4 } from "node:crypto";

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
    const source = tag(block, "source") ?? (rawTitle.includes(" - ") ? rawTitle.split(" - ").pop() ?? "" : "");
    const title = source && rawTitle.endsWith(` - ${source}`) ? rawTitle.slice(0, -(source.length + 3)) : rawTitle;
    const link = tag(block, "link");
    const published = tag(block, "pubDate");
    const description = tag(block, "description") ?? "";
    const parsedDate = published ? Date.parse(published) : Number.NaN;
    return {
      title,
      source,
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
var normalizedWords = (value) => value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
function legalCaptionHasFullName(caseName, resolvedName) {
  const nameWords = normalizedWords(resolvedName);
  if (nameWords.length < 2) return false;
  const caption = ` ${normalizedWords(caseName).join(" ")} `;
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
      const normalized = normalizeSanctionsName(raw || "");
      if (normalized && normalized.includes(" ")) names.add(normalized);
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

// server/adapters/profilePhoto.ts
import { createHash as createHash3 } from "node:crypto";
var ANTHROPIC_URL2 = "https://api.anthropic.com/v1/messages";
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
var sha2562 = (value) => createHash3("sha256").update(value).digest("hex");
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
    response = await fetch(ANTHROPIC_URL2, {
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
  const artifactHash = sha2562(JSON.stringify(artifactRecord));
  addArtifact(ctx, {
    kind: "profile_photo",
    provider: "claude-vision",
    title: "Profile-photo integrity screen",
    sourceUrl: image.url,
    capturedAt,
    contentHash: artifactHash,
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
var hashArtifact = (artifact) => createHash4("sha256").update(JSON.stringify({
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
    const ofacPromise = name ? collectOfacName(name, {
      cache: {
        read: () => cacheGet("ofacname:v2", {
          operation: "ofac-name-index-hit",
          meta: "24h OFAC name-index cache"
        }),
        write: (names) => cacheSet("ofacname:v2", names)
      }
    }) : null;
    const [news, profilePhoto, legal, ofac] = await Promise.all([
      newsPromise,
      profilePhotoPromise,
      legalPromise ?? Promise.resolve(null),
      ofacPromise ?? Promise.resolve(null)
    ]);
    recordAttempts(news.attempts);
    if (legal) recordAttempts(legal.attempts);
    if (ofac) recordAttempts(ofac.attempts);
    if (news.status !== "succeeded") {
      ctx.recordCheck?.({
        id: "news-press",
        status: "unavailable",
        note: failedCheckNote("Google News search", news.status, news.attempts),
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
    if (legal) {
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
    }
    if (ofac) {
      if (ofac.status !== "succeeded" || !ofac.value.available) {
        ctx.recordCheck?.({
          id: "ofac-sanctions-name",
          status: "unavailable",
          note: failedCheckNote("OFAC name screen", ofac.status, ofac.attempts),
          provider: "opensanctions"
        });
      } else {
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
      }
    }
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
  const clean = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
  if (!clean || !name) return null;
  const needles = nameNeedles(name);
  if (!needles.length) return null;
  const paths = [`${clean}/team`, `${clean}/about`, clean];
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
          where: p.replace(clean, "").replace(/^\//, "") || "homepage"
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
  const add = (address, chain, source) => {
    if (!address) return;
    const k = address.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ address, chain, source, tier: "SelfDoxxed" });
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
import { createHash as createHash5 } from "node:crypto";

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
function coverageQualifiedCompleteness(input) {
  const completeness = normalizedCompleteness(input.completeness);
  if (completeness === "failed") return "failed";
  if (input.attestation !== void 0 && !TRUSTED_ATTESTATIONS.has(input.attestation)) {
    return "partial";
  }
  if (input.checks === void 0) return completeness;
  const applicable = input.checks.filter((value) => {
    const check = checkRecord(value);
    const metadata = checkRecord(check.metadata);
    return check.status !== "not-applicable" && check.state !== "not-applicable" && check.notApplicable !== true && metadata.notApplicable !== true;
  });
  if (!applicable.length) return "partial";
  const everyCheckCompleted = applicable.every((value) => {
    const check = checkRecord(value);
    return !checkIsStale(check, Date.now()) && SUCCESSFUL_CHECK_STATES.has(String(check.status ?? check.state ?? ""));
  });
  return completeness === "complete" && everyCheckCompleted ? "complete" : "partial";
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
    for (const n of c.nodes) {
      if (isGenericKey(String(n.key))) continue;
      const k = resolve(n.key);
      const label = typeof n.label === "string" && n.label.trim() ? n.label : String(n.key);
      if (k !== me) mine.set(k, { label, type: String(n.type) });
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
    if (mine.has(other)) {
      const e = ensure(other, otherLabel, c.verdict);
      e.direct = true;
    }
    for (const n of c.nodes) {
      if (isGenericKey(String(n.key))) continue;
      const k = resolve(n.key);
      if (k !== me && k !== other && mine.has(k)) {
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
      if (!UUID.test(id) || !group.includes(id) || !FINAL_VERDICTS2.has(verdict) || completeness !== "complete" && completeness !== "partial" && completeness !== "failed" || attestation !== "server_collected" && attestation !== "analyst_submitted" && attestation !== "legacy_unattested" || out.has(id)) {
        throw new Error("graph report-version metadata was malformed or ambiguous");
      }
      out.set(id, { id, verdict, completeness, attestation });
    }
  }
  if (out.size !== ids.length) throw new Error("graph report-version qualification was incomplete");
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
  return createHash5("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
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
  const checksAttested = checks.length === EXPECTED_PERSON_CHECK_IDS.size && checkIds.size === EXPECTED_PERSON_CHECK_IDS.size && [...EXPECTED_PERSON_CHECK_IDS].every((checkId) => checkIds.has(checkId)) && checks.every((check) => check.attestation_state === "server_collected");
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
function addGraphFinding(ctx, connection, tie, artifactHash, capturedAt) {
  if (!connection.qualified || !connection.otherReportVersionId || connection.otherAttestation !== "server_collected" || connection.otherCompleteness !== "complete" || !connection.otherVerdict || !ADVERSE_VERDICTS2.has(connection.otherVerdict) || tie.strength === "weak" || tie.strength === "hard" && !HARD_TIE_KEY.test(tie.key) || !HASH.test(artifactHash) || !tie.subjectEdgeTypes.length || !tie.otherEdgeTypes.length) return;
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
    content_hash: artifactHash,
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
    const qualified = stored.map((row) => qualification(
      row,
      versions.get(row.reportVersionId),
      checks.get(row.reportVersionId) ?? [],
      activeVersions.has(row.reportVersionId)
    ));
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
    const artifactHash = semanticHash({
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
      sourceContentHash: artifactHash,
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
      contentHash: artifactHash,
      sourceContentHash: artifactHash,
      excerpt: line,
      match: status === "risk" ? "risk_signal" : status === "clear" ? "screened_clear" : "observed",
      ...status === "incomplete" ? { coverageState: "unavailable" } : {}
    });
    for (const connection of adverse) {
      const tie = strongestTie(connection.ties);
      if (tie) addGraphFinding(ctx, connection, tie, artifactHash, capturedAt);
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

// server/orchestrate.ts
var ADAPTERS = [
  xAdapter,
  githubAdapter,
  peopledatalabsAdapter,
  offchainAdapter,
  crunchbaseAdapter,
  dexscreenerAdapter,
  coingeckoAdapter,
  redditAdapter,
  onchainAdapter
];
var KEYED = /* @__PURE__ */ new Set(["x", "github", "peopledatalabs", "crunchbase", "reddit", "onchain"]);
var attemptTotals = (providers) => {
  const allow = providers ? new Set(providers) : null;
  return getCost().calls.reduce((totals, line) => {
    if (allow && !allow.has(line.provider)) return totals;
    totals.total += line.calls;
    totals.succeeded += line.succeeded;
    totals.partial += line.partial;
    totals.failed += line.failed;
    totals.cached += line.cached;
    return totals;
  }, { total: 0, succeeded: 0, partial: 0, failed: 0, cached: 0 });
};
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
async function coldIntake(ctx) {
  let siteUrl;
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
    siteUrl = prof.website;
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
    ctx.emit({ phase: "P0 \xB7 Intake", label: "Handle history", detail: `This account previously went by ${hist.priorHandles.map((p) => "@" + p).join(", ")} \u2014 a rebrand. Old posts and mentions are searched too.`, source: "memory.lol", tone: "warn" });
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
  if (!analystAvailable()) return;
  ctx.emit({ phase: "P0 \xB7 Intake", label: "Extract claims", detail: "Reading the subject's bio and posts for self-claims to verify\u2026", tone: "neutral" });
  const bioDomain = ctx.evidence.profile.bio.match(/\b([a-z0-9-]+\.(?:xyz|io|com|fi|net|finance|app|org|co|gg|network|dev|ai|so|money))\b/i)?.[1];
  const domain = (siteUrl ?? (bioDomain ? `https://${bioDomain}` : "")).replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const teamDomain = domain || `${ctx.handle.replace(/^@/, "").toLowerCase()}.com`;
  const claimsPromise = extractClaims(ctx.handle, ctx.evidence.profile.bio, posts);
  const discoveryPromise = Promise.all([
    discoverAffiliations(ctx.handle, ctx.evidence.profile.display_name, ctx.evidence.profile.prior_handles ?? []),
    findTeam(ctx.handle, ctx.evidence.profile.display_name, ctx.evidence.recentActivity),
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
        source_author: "claude-intake",
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
    ctx.emit({ phase: "P0 \xB7 Intake", label: "Claims extracted", detail: `${n} self-claims across ${candidateRoles.join(", ") || "no role candidates"} \u2014 role candidates remain non-governing until independently verified.`, source: "claude", tone: "neutral" });
  }
  ctx.emit({ phase: "P0 \xB7 Intake", label: "Discover affiliations", detail: "Three angles in parallel: what this account is tied to, who has named them, and the team named in their own X posts\u2026", source: "grok", tone: "neutral" });
  const [bySubject, people, siteTeam, pageTeam] = await discoveryPromise;
  const postRoleTeam = scanPostsForRoles(ctx.evidence.recentActivity);
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
        existing.evidence_origin = "deterministic";
        existing.artifact_verified = true;
        existing.provider = t.provider;
        existing.source = t.source ?? existing.source;
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
    ctx.emit({ phase: "P1 \xB7 Team", label: "Uncorroborated team lead", detail: `Found a possible team for the name "${ctx.evidence.profile.display_name || ctx.handle}", but nothing ties THIS account to it \u2014 its handle isn't independently matched, it links no site, and its own posts name no team. Preserved for follow-up but excluded from scoring and the trust graph.`, source: "team-search", tone: "warn" });
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
    ctx.emit({ phase: "P1 \xB7 Team", label: "No named team", detail: `Dug ${domain} and the account's posts; no individual team members could be attributed. For a project raising money, an unnamed team is itself a flag.`, source: "team-search", tone: "warn" });
  }
  if (domain) {
    const site = await checkSiteSubstance(domain).catch(() => null);
    if (site) {
      ctx.evidence.profile.website = site.url;
      if (site.status === "coming_soon" || site.status === "unreachable") {
        const notLive = site.status === "unreachable" ? "does not resolve" : "is not live yet";
        ctx.evidence.findings.push({
          finding_type: "SiteNotLive",
          claim: `The project's own website (${domain}) ${notLive}: ${site.detail}. No live product surface despite the account promoting a token.`,
          source_url: site.url,
          source_date: "",
          source_author: "site-fetch",
          verification_status: "Verified",
          independent_source_count: 1,
          polarity: -1,
          evidence_origin: "deterministic",
          artifact_verified: true
        });
        ctx.emit({ phase: "P2 \xB7 Substance", label: "Website not live", detail: `${domain} ${notLive} \u2014 ${site.detail}. A project promoting a token with no live site is early/unshipped; weigh against product-substance claims.`, source: "site-fetch", tone: "bad" });
      } else if (site.status === "client_rendered") {
        ctx.emit({ phase: "P2 \xB7 Substance", label: "Website live (app)", detail: `${domain} serves a client-rendered app; ${site.detail}.`, source: "site-fetch", tone: "neutral" });
      } else {
        ctx.emit({ phase: "P2 \xB7 Substance", label: "Website live", detail: `${domain} is a live site \u2014 ${site.detail}.`, source: "site-fetch", tone: "good" });
      }
    }
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
          ctx.emit({ phase: "P0 \xB7 Intake", label: `Affiliation corroborated \xB7 ${v.name}`, detail: `${v.role}${v.year ? `, ${v.year}` : ""} \u2014 ${corrob.join("; ")}.`, source: "argus", tone: "good" });
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
    classifySubject(evidence.profile.bio).applicable_classes.forEach((role) => roles.add(role));
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
  return [...roles];
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
    verification_status: hasCandidateArtifact ? "Reported" : "Rumor",
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
      ctx.emit({ phase: "Network", label: "Venture teams mapped", detail: `${total} people across ${ctx.evidence.ventureTeams.length} venture${ctx.evidence.ventureTeams.length === 1 ? "" : "s"} wired into the graph \u2014 subject \u2192 venture \u2192 the people behind it.`, source: "grok", tone: "good" });
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
      followers: "\u2014",
      joined: "\u2014",
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
    profileAuthenticity: void 0,
    trustGraphScreen: void 0,
    webTeam: [],
    ventureTeams: []
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
  emit({ phase: "P0 \xB7 Intake", label: "Resolve handle", detail: `Normalizing ${rawHandle} and opening the audit ledger.`, tone: "neutral" });
  const ctx = {
    handle: evidence.profile.handle,
    organizationId: options?.organizationId,
    evidence,
    emit,
    recordCheck: (observation) => checkTracker.record(observation)
  };
  if (!fixture) {
    const stageStartedAt = startRuntimeStage("cold-intake");
    await coldIntake(ctx);
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
      } else if (a.id === "crunchbase") {
        checkTracker.record({
          id: "vc-portfolio-track-record",
          status: "unavailable",
          note: "Crunchbase provider is not configured",
          provider: "crunchbase"
        });
      }
      continue;
    }
    const stageStartedAt = startRuntimeStage(`adapter:${a.id}`);
    try {
      const before = attemptTotals();
      const result = await a.run(ctx);
      const attempts = attemptDelta(before, attemptTotals());
      const state = adapterRunState(result, attempts);
      const detail = result?.detail ?? (state === "skipped" ? "no applicable provider call was observed" : `${attempts.total} provider attempt${attempts.total === 1 ? "" : "s"} observed`);
      checkTracker.provider(a.id, a.label, state, detail);
    } catch (e) {
      checkTracker.provider(a.id, a.label, "failed", String(e));
      if (a.id === "github") {
        checkTracker.record({ id: "code-footprint-github", status: "unavailable", note: `GitHub adapter failed: ${String(e)}`, provider: "github" });
      } else if (a.id === "crunchbase") {
        checkTracker.record({ id: "vc-portfolio-track-record", status: "unavailable", note: `Crunchbase adapter failed: ${String(e)}`, provider: "crunchbase" });
      }
      emit({ phase: "Collect", label: `${a.label} error`, detail: String(e), tone: "warn" });
    }
    finishRuntimeStage(`adapter:${a.id}`, stageStartedAt);
  }
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
    checkOutcomes: checkTracker.snapshot(evidence.roles, { resolvedRealName: hasResolvedRealName(ctx) }),
    providerRuns: checkTracker.providers().runs
  };
  const analystStartedAt = startRuntimeStage("analyst");
  if (analystAvailable()) {
    emit({ phase: "Contradictions", label: "Scan materials", detail: "Cross-referencing every claim against the collected evidence for internal contradictions\u2026", tone: "neutral" });
    emit({ phase: "Analyst", label: "Score axes", detail: "Claude analyst scoring every axis from the collected evidence\u2026", tone: "neutral" });
    const requestedAxes = axisCatalog(evidence.roles);
    const evidenceJson = buildScoringEvidencePacket(baseEvidence, requestedAxes);
    const frozenAxisEvidence = extractScoringEvidenceCatalog(evidenceJson);
    if (frozenAxisEvidence.length > 0) {
      evidence.axisCitationVersion = 1;
      evidence.axisEvidenceCatalog = frozenAxisEvidence;
    }
    evidence.axes = [];
    const analystBefore = attemptTotals(["claude"]);
    const analystDeadlineAt = options?.analystDeadlineAt ?? runtimeStartedAt + DEEP_INVESTIGATION_MAX_DURATION_SECONDS * 1e3 - ANALYST_FINALIZATION_RESERVE_MS;
    const [found, verdict] = await Promise.all([
      scanContradictions(evidence.profile.handle, evidenceJson, { deadlineAt: analystDeadlineAt }),
      analyzeSubject(evidence.profile.handle, evidence.roles, requestedAxes, evidenceJson, {
        analystDeadlineAt
      })
    ]);
    const analystAttempts = attemptDelta(analystBefore, attemptTotals(["claude"]));
    const analystObserved = analystAttempts.total > 0;
    if (analystObserved && found && found.length) {
      evidence.contradictions = found;
      const worst = found.some((c) => c.severity === "high") ? "bad" : "warn";
      emit({ phase: "Contradictions", label: `${found.length} contradiction${found.length === 1 ? "" : "s"}`, detail: found.slice(0, 3).map((c) => `${c.claim} vs ${c.conflict}`).join(" \xB7 "), source: "claude", tone: worst });
    } else if (analystObserved && found) {
      emit({ phase: "Contradictions", label: "None found", detail: "No internal contradictions surfaced across the subject's claims and the evidence.", source: "claude", tone: "good" });
    } else {
      emit({ phase: "Contradictions", label: "Incomplete", detail: "Contradiction analysis did not return a complete result.", source: "claude", tone: "warn" });
    }
    if (analystObserved && verdict) {
      evidence.axes = verdict.axes;
      evidence.headline = verdict.headline || evidence.headline;
      if (verdict.identity_note) evidence.profile.identity_note = verdict.identity_note;
      emit({ phase: "Analyst", label: "Scored", detail: `${verdict.axes.length} axes scored.`, source: "claude", tone: "good" });
    } else {
      evidence.headline = "Investigation incomplete: the analyst did not return one valid score for every required axis.";
      emit({ phase: "Analyst", label: "Incomplete", detail: "The analyst response was unavailable, partial, duplicated an axis, or contained an invalid score. No verdict score will be published.", tone: "warn" });
    }
    const analystState = !analystObserved ? "skipped" : verdict ? "executed" : observedRunState(analystAttempts) === "failed" ? "failed" : "partial";
    checkTracker.provider(
      "claude-analyst",
      "Claude analyst",
      analystState,
      analystObserved ? `${analystAttempts.total} observed attempt${analystAttempts.total === 1 ? "" : "s"}; ${verdict ? "complete axis set returned" : "axis result incomplete"}` : "no Claude provider attempt was observed"
    );
  } else {
    checkTracker.provider("claude-analyst", "Claude analyst", "unavailable", "analyst provider is not configured");
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
  dossier.completeness_state = checkTracker.completeness(evidence.roles, checkScope);
  dossier.providerSnapshot = checkTracker.providers();
  dossier.cost = cost;
  emit({ phase: "Finalize", label: "Audit cost", detail: `~$${cost.usd.toFixed(2)} this audit (Grok $${cost.grokUsd.toFixed(2)} across ${cost.grokCalls} searches \u2248${cost.sources} sources \xB7 Claude $${cost.claudeUsd.toFixed(2)} across ${cost.claudeCalls} calls).`, tone: "neutral" });
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
        findings.push({ claim: `honeypot.is reported a failed sell simulation, but the GoPlus on-chain check and ${why} contradict it \u2014 treated as a simulation artifact, not a honeypot.`, tone: "warn", source: "argus" });
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
    const govNote = established ? " On a token with real centralized-exchange listings this is typically a governed emissions/ops mechanism, not a rug setup \u2014 confirm the controller." : "";
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
var approvedHost = (hostname, root) => hostname === root || hostname.endsWith(`.${root}`);
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
  const hostname = parsedUrl?.hostname.toLowerCase() ?? "";
  const isDexUrl = !!parsedUrl && approvedHost(hostname, "dexscreener.com");
  const isXUrl = !!parsedUrl && (approvedHost(hostname, "x.com") || approvedHost(hostname, "twitter.com"));
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
