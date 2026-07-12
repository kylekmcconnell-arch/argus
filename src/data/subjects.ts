// High-fidelity audit subjects. Each carries the evidence an autonomous
// collector would surface, plus the analyst-grade axis scores derived from it.
// buildReport() runs them through the REAL ported engine — these reports are
// computed, not written. Handles are fictional archetypes drawn from the
// whitepaper's worked examples.

import { Audit, SubjectClass, VentureOutcome, type IdentityConfidence } from "../engine";
import { type AxisInput, type TraceStep, type CollectedEvidence } from "./evidence";
import { assembleDossier, type Dossier } from "./dossier";

export type { AxisInput, TraceStep } from "./evidence";

export interface SubjectFixture {
  handle: string;
  display_name: string;
  avatar: string; // emoji or initials
  bio: string;
  followers: string;
  joined: string;
  identity: IdentityConfidence;
  identity_note: string;
  roles: SubjectClass[];
  headline: string; // one-line analyst summary
  build: (a: Audit) => void; // record evidence
  axes: AxisInput[];
  trace: TraceStep[];
}

// Round-trips a fixture's recorded evidence into the shared CollectedEvidence
// bag, so a fixture and the live collector produce the identical shape.
export function toEvidence(f: SubjectFixture): CollectedEvidence {
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
      identity_note: f.identity_note,
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
      notes: as.notes,
    })),
    findings: a.getFindings(),
    axes: f.axes,
    headline: f.headline,
    recentActivity: [],
    notableFollowers: [],
    contradictions: [],
    sourceArtifacts: [],
  };
}

export function buildReport(f: SubjectFixture): Dossier {
  return assembleDossier(toEvidence(f), false);
}

// ─────────────────────────────────────────────────────────────────────────
// 1. @0xlumen — the flagship multi-role subject (the "EnigmaFund shape").
//    Looks elite: claimed exit, a fund, advisory seats, a wall of big names.
//    ARGUS catches: testimonials nobody acknowledges, and an advised project
//    that rugged while the subject held an allocation. Composite governed by
//    the most severe role. Pseudonymous, but not penalised for it.
// ─────────────────────────────────────────────────────────────────────────
const lumen: SubjectFixture = {
  handle: "@0xlumen",
  display_name: "lumen",
  avatar: "◎",
  bio: "founder. building the on-chain future. ex-@meridianlabs (acq). GP @ Lumen Capital. advisor to 9 protocols. opinions are alpha.",
  followers: "184.2K",
  joined: "Mar 2021",
  identity: "Unverified",
  identity_note:
    "Persistent pseudonym since 2021 with a consistent on-chain footprint. Pseudonymity is not a flag; disclosure would have earned a bonus.",
  roles: [SubjectClass.FOUNDER, SubjectClass.INVESTOR, SubjectClass.ADVISOR],
  headline:
    "Real building history undercut by a manufactured endorsement wall and a paid advisory seat on a confirmed rug. The advisor role governs.",
  build: (a) => {
    // Founder track — one genuine exit, one active build.
    a.addVenture({
      project_name: "Meridian Labs",
      role: "co-founder",
      period: "2019-2022",
      outcome: VentureOutcome.ACQUISITION,
      acquirer: "Chainforge",
      deal_type: "strategic",
      deal_value_usd: 28e6,
      investors: ["Variant", "Dragonfly"],
      evidence_url: "https://chainforge.xyz/blog/acquiring-meridian",
    });
    a.addVenture({
      project_name: "Lumen Protocol",
      role: "founder",
      period: "2023-present",
      outcome: VentureOutcome.ACTIVE,
      current_backers: ["Dragonfly", "Robot Ventures"],
      evidence_url: "https://github.com/lumen-protocol",
    });
    // Investor track — endorsement wall that nobody acknowledges.
    a.addTestimonial({ claimed_endorser_handle: "@cdixon", claimed_relationship: "portfolio", public_acknowledgment: "none", follows_subject: false, appears_at: "lumencapital.xyz" });
    a.addTestimonial({ claimed_endorser_handle: "@haydenzadams", claimed_relationship: "co-investor", public_acknowledgment: "none", follows_subject: false, appears_at: "lumencapital.xyz" });
    a.addTestimonial({ claimed_endorser_handle: "@StaniKulechov", claimed_relationship: "portfolio", public_acknowledgment: "none", follows_subject: false, appears_at: "lumencapital.xyz" });
    a.addTestimonial({ claimed_endorser_handle: "@gabby", claimed_relationship: "advisor_to_subject", public_acknowledgment: "mention", follows_subject: true, relationship_corroborated: false, appears_at: "lumencapital.xyz" });
    // Advisor track — one acknowledged seat, and one fatal one.
    a.addAdvisedProject({ project_name: "Helix Finance", project_handle: "@helixfi", public_acknowledgment: "thanks", relationship_corroborated: true, follows_subject: true, project_outcome: VentureOutcome.ACTIVE, paid_or_allocated: true });
    a.addAdvisedProject({
      project_name: "ZenithDAO",
      project_handle: "@zenithdao",
      claimed_role: "strategic advisor",
      public_acknowledgment: "endorsement",
      relationship_corroborated: true,
      follows_subject: true,
      project_outcome: VentureOutcome.RUG,
      paid_or_allocated: true,
      evidence_url: "https://rugpull.report/zenithdao",
      notes: "Token allocation vested to the subject; project drained LP Apr 2024.",
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
    { axis: "F2_track_record", score: 22, rationale: "One verified strategic exit (Meridian → Chainforge, $28M). Current build is active and real." },
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
    { axis: "AD5_reputation_fud", score: 9, rationale: "Named in post-rug community threads about ZenithDAO advisors." },
  ],
  trace: [
    { phase: "P0 · Intake", label: "Resolve handle", detail: "@0xlumen → canonical key. Cross-referencing roster KB across 1,204 entries.", tone: "neutral" },
    { phase: "P0 · Routing", label: "Classify roles", detail: "Bio signals: founder, GP, advisor. Routed to 3 tracks: FOUNDER, INVESTOR, ADVISOR.", tone: "neutral" },
    { phase: "P1 · Identity", label: "Identity check", detail: "Persistent pseudonym since 2021, consistent on-chain footprint. No impersonation. Scored on merits.", tone: "good" },
    { phase: "Founder", label: "Enumerate ventures", detail: "Meridian Labs → acquired by Chainforge ($28M strategic). Verified against acquirer press.", source: "chainforge.xyz", tone: "good" },
    { phase: "Founder", label: "Repeat-backing", detail: "Dragonfly backed Meridian (exit) and re-backed Lumen. Strongest positive signal in venture.", tone: "good" },
    { phase: "Investor", label: "Corroborate endorsements", detail: "4 marquee names on the fund site. Checking each against their real X behaviour…", tone: "neutral" },
    { phase: "Investor", label: "Endorsement verdict", detail: "3 of 4 never followed, mentioned, or acknowledged the subject. The wall is unconfirmed. I4 collapses to 4/20.", source: "X API", tone: "warn" },
    { phase: "Advisor", label: "Advisory graveyard", detail: "9 claimed seats → 2 with evidence. Helix: active, acknowledged. ZenithDAO: acknowledged…", tone: "neutral" },
    { phase: "Advisor", label: "ZenithDAO outcome", detail: "ZenithDAO drained LP ~$4.1M Apr 2024. Subject held a vested allocation. Paid-advisor-to-rug cap fires (25).", source: "rugpull.report", tone: "bad" },
    { phase: "Finalize", label: "Govern composite", detail: "FOUNDER and INVESTOR scored on merits; ADVISOR cap governs. Roles never averaged.", tone: "warn" },
  ],
};

// ─────────────────────────────────────────────────────────────────────────
// 2. @satoshi_builds — a clean PASS. Serial success, repeat backing, real
//    code, disclosed identity (dox bonus). Proves the system is fair, not a
//    hit-piece generator.
// ─────────────────────────────────────────────────────────────────────────
const satoshi: SubjectFixture = {
  handle: "@satoshi_builds",
  display_name: "Mara Voss",
  avatar: "M",
  bio: "Founder & CEO @ Tideglass. Previously founded Northwind (acq. by Stripe) and Loom Data (IPO). Building dev infra. she/her.",
  followers: "92.7K",
  joined: "Jun 2017",
  identity: "Confirmed",
  identity_note: "Doxxed, consistent LinkedIn + press history. Earns the +5 disclosure bonus.",
  roles: [SubjectClass.FOUNDER],
  headline: "Two real exits, a returning tier-1 backer, and shipped code. A clean, investment-grade founder profile.",
  build: (a) => {
    a.addVenture({ project_name: "Northwind", role: "founder", period: "2014-2018", outcome: VentureOutcome.ACQUISITION, acquirer: "Stripe", deal_type: "strategic", deal_value_usd: 64e6, investors: ["Sequoia", "Index"], evidence_url: "https://stripe.com/newsroom/northwind" });
    a.addVenture({ project_name: "Loom Data", role: "co-founder", period: "2018-2021", outcome: VentureOutcome.IPO, investors: ["Index", "a16z"], evidence_url: "https://sec.gov/loomdata-s1" });
    a.addVenture({ project_name: "Tideglass", role: "founder", period: "2022-present", outcome: VentureOutcome.ACTIVE, current_backers: ["Sequoia", "Index"], evidence_url: "https://github.com/tideglass" });
    a.addFinding({ finding_type: "Exit", claim: "Northwind acquired by Stripe (2018, strategic).", source_url: "https://stripe.com/newsroom/northwind", source_date: "2018-05-02", verification_status: "Verified", independent_source_count: 4, polarity: 1 });
    a.addFinding({ finding_type: "IPO", claim: "Loom Data IPO'd on NASDAQ (2021).", source_url: "https://sec.gov/loomdata-s1", source_date: "2021-11-10", verification_status: "Verified", independent_source_count: 5, polarity: 1 });
  },
  axes: [
    { axis: "F1_identity_verifiability", score: 12, rationale: "Fully doxxed; consistent decade-long public history." },
    { axis: "F2_track_record", score: 27, rationale: "Two verified exits: Northwind (acq. Stripe) and Loom Data (IPO). No failures, no rug." },
    { axis: "F3_repeat_backing", score: 14, rationale: "Sequoia and Index, backers of both prior wins, re-backed Tideglass. Strong returning-backer signal." },
    { axis: "F4_build_substance", score: 14, rationale: "Active GitHub org, original technical commits, shipped product." },
    { axis: "F5_reputation_integrity", score: 17, rationale: "No litigation, no investigator findings, strong founder references." },
    { axis: "F6_network_quality", score: 11, rationale: "Tier-1 co-founders and backers; no cabal proximity." },
  ],
  trace: [
    { phase: "P0 · Intake", label: "Resolve handle", detail: "@satoshi_builds → canonical key. No roster KB hit (not a paid promoter).", tone: "neutral" },
    { phase: "P0 · Routing", label: "Classify roles", detail: "Bio signals founder/CEO. Single track: FOUNDER.", tone: "neutral" },
    { phase: "P1 · Identity", label: "Identity check", detail: "Doxxed, decade of consistent press + LinkedIn. Confirmed → +5 disclosure bonus.", tone: "good" },
    { phase: "Founder", label: "Enumerate ventures", detail: "Northwind → Stripe (acq.). Loom Data → IPO. Both verified against primary sources.", source: "sec.gov · stripe.com", tone: "good" },
    { phase: "Founder", label: "Repeat-backing", detail: "Sequoia + Index backed both wins and re-backed the current company. Strong.", tone: "good" },
    { phase: "Founder", label: "Build substance", detail: "Active GitHub org, original commits, live product. Builder persona is real.", source: "github.com", tone: "good" },
    { phase: "Finalize", label: "Score & band", detail: "All axes strong, no caps, +5 dox bonus. Lands firmly in PASS.", tone: "good" },
  ],
};

// ─────────────────────────────────────────────────────────────────────────
// 3. @nova_capital — a fund whose entire credibility is borrowed. Marquee
//    testimonials, one of which the named founder openly contradicts.
//    Contradicted testimonial caps the score (15) and seeds a deception flag.
// ─────────────────────────────────────────────────────────────────────────
const nova: SubjectFixture = {
  handle: "@nova_capital",
  display_name: "Nova Capital",
  avatar: "N",
  bio: "Early-stage crypto fund. Backed 40+ winners. Trusted by the best founders in the space. DURB to pitch.",
  followers: "47.1K",
  joined: "Sep 2023",
  identity: "Probable",
  identity_note: "Named managing partner with a thin but real footprint. Probable → +3 disclosure bonus.",
  roles: [SubjectClass.INVESTOR],
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
    { axis: "I5_reputation_fud", score: 11, rationale: "Emerging founder complaints about misrepresented relationships." },
  ],
  trace: [
    { phase: "P0 · Intake", label: "Resolve handle", detail: "@nova_capital → canonical key. Account created Sep 2023 vs. '40+ winners' claim. Flag the mismatch.", tone: "warn" },
    { phase: "P0 · Routing", label: "Classify roles", detail: "Fund / investor signals. Single track: INVESTOR.", tone: "neutral" },
    { phase: "P1 · Identity", label: "Identity check", detail: "Named partner, thin footprint. Probable → +3 bonus. Not gated.", tone: "neutral" },
    { phase: "Investor", label: "Portfolio reality", detail: "Claimed 40+ winners. Cross-referencing Pitchbook / Crunchbase / AngelList… most entries absent.", source: "pitchbook", tone: "warn" },
    { phase: "Investor", label: "Corroborate endorsements", detail: "4 marquee testimonials on novacap.io/founders. Locating each endorser's account…", tone: "neutral" },
    { phase: "Investor", label: "Contradiction found", detail: "@DefiDad publicly denies any relationship and asked to be removed. Contradicted testimonial cap fires (15) + deception flag.", source: "x.com/DefiDad", tone: "bad" },
    { phase: "Finalize", label: "Score & band", detail: "Strong scores elsewhere cannot dilute a contradicted endorsement. Capped at 15.", tone: "bad" },
  ],
};

// ─────────────────────────────────────────────────────────────────────────
// 4. @deltagrowth — an agency selling manipulation as a product. Capped to
//    AVOID regardless of a slick site.
// ─────────────────────────────────────────────────────────────────────────
const delta: SubjectFixture = {
  handle: "@deltagrowth",
  display_name: "Delta Growth",
  avatar: "Δ",
  bio: "Full-service Web3 growth. KOL management · market making · trending · raids. 200+ launches. Guaranteed engagement.",
  followers: "31.4K",
  joined: "Jan 2022",
  identity: "Confirmed",
  identity_note: "Registered entity with a named team. Identity is not the problem here.",
  roles: [SubjectClass.AGENCY],
  headline: "A registered, well-branded agency whose core product is manufactured engagement. Service integrity caps it to AVOID.",
  build: (a) => {
    a.addClientEngagement({ client_name: "Pulsechain memecoins (12)", service_type: "market_making", manipulation_service_flag: true, notes: "Wash-trading packages sold as 'volume' tiers.", evidence_url: "https://x.com/zachxbt/delta-volume" });
    a.addClientEngagement({ client_name: "Various", service_type: "raids", manipulation_service_flag: true, notes: "Coordinated bot raids + fake engagement marketed openly.", client_outcome: VentureOutcome.SILENT_SHUTDOWN });
    a.addClientEngagement({ client_name: "ZenithDAO", service_type: "market_making", manipulation_service_flag: true, notes: "Sold 'volume' for ZenithDAO in the weeks before its LP was drained. This is the same project @0xlumen advised.", evidence_url: "https://x.com/zachxbt/delta-volume" });
    a.addFinding({ finding_type: "InvestigatorCallout", claim: "Sells wash trading and bot engagement as productized 'volume' and 'trending' tiers.", source_url: "https://x.com/zachxbt/delta-volume", source_date: "2024-12-03", verification_status: "Verified", independent_source_count: 2, source_author: "@zachxbt", polarity: -1 });
    a.addAssociate({ associate_handle: "@vexnode", relation: "repeat-client", in_cabal_kb: true });
  },
  axes: [
    { axis: "AG1_identity_legitimacy", score: 11, rationale: "Registered entity, named team, real footprint. Treated as a contractor." },
    { axis: "AG2_client_outcomes", score: 9, rationale: "Client roster heavy with failed launches and silent shutdowns." },
    { axis: "AG3_service_integrity", score: 3, rationale: "Wash trading, bot raids and fake engagement sold as productized tiers." },
    { axis: "AG4_reputation_fud", score: 12, rationale: "Investigator callouts and sustained community FUD on the agency itself." },
  ],
  trace: [
    { phase: "P0 · Intake", label: "Resolve handle", detail: "@deltagrowth → canonical key. Treated as a contractor, not a principal.", tone: "neutral" },
    { phase: "P0 · Routing", label: "Classify roles", detail: "Agency / growth / market-making signals. Single track: AGENCY.", tone: "neutral" },
    { phase: "Agency", label: "Service integrity", detail: "Site openly sells 'volume' and 'trending' tiers. Parsing for manipulation services…", tone: "warn" },
    { phase: "Agency", label: "Manipulation confirmed", detail: "Wash trading + bot raids productized. Investigator-verified (@zachxbt, 2 sources). Cap fires (10).", source: "x.com/zachxbt", tone: "bad" },
    { phase: "Finalize", label: "Score & band", detail: "Manipulation-as-a-service is a hard cap at 10. A clean brand cannot lift it. AVOID.", tone: "bad" },
  ],
};

export const SUBJECTS: SubjectFixture[] = [lumen, satoshi, nova, delta];

export function findSubject(handle: string): SubjectFixture | undefined {
  const norm = handle.trim().toLowerCase().replace(/^@/, "").replace(/.*\/(?=[^/]+$)/, "");
  return SUBJECTS.find((s) => s.handle.toLowerCase().replace("@", "") === norm);
}
