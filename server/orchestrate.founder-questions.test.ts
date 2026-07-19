import { describe, expect, it } from "vitest";
import { SubjectClass } from "../src/engine";
import {
  emptyEvidence,
  type BasicFact,
  type BasicFactLead,
  type BasicFactPredicate,
  type BasicFactQuestionLedgerEntry,
} from "../src/data/evidence";
import { deriveDecisionReadiness } from "../src/lib/decisionReadiness";
import type { CheckObservation, CollectContext } from "./adapters/types";
import { PersonCheckTracker } from "./checks";
import { collectFounderDecisionQuestionOutcomes } from "./orchestrate";

const run = (
  predicate: BasicFactPredicate,
  status: BasicFactQuestionLedgerEntry["status"],
  state: BasicFactQuestionLedgerEntry["providerRuns"][number]["state"] = "succeeded",
): BasicFactQuestionLedgerEntry => ({
  questionId: `person.${predicate}`,
  audience: "person",
  batch: ["official_identity", "current_role", "founder"].includes(predicate) ? "identity" : "structure_risk",
  predicate,
  question: `Question for ${predicate}`,
  critical: true,
  status,
  answerRefs: status === "answered" ? [`answer:${predicate}`] : [],
  providerRuns: [{ phase: "primary", provider: "claude-web-search", state }],
});

const fact = (predicate: BasicFactPredicate, value: string): BasicFact => ({
  factId: `fact-${predicate}`,
  subjectKey: "@founder",
  predicate,
  value,
  normalizedValue: value.toLowerCase(),
  status: "verified",
  critical: true,
  ...(predicate === "legal_regulatory_event" ? {
    eventStatus: "resolved",
    attributedEntity: "Founder Name",
    attributionScope: "direct_subject" as const,
  } : {}),
  sources: [{
    url: `https://example.com/${predicate}`,
    sourceClass: predicate === "legal_regulatory_event" ? "regulatory_or_onchain" : "official_subject",
    relation: "supports",
    excerpt: value,
    contentHash: predicate.padEnd(64, "0").slice(0, 64),
    capturedAt: "2026-07-13T00:00:00.000Z",
    provider: "public-web",
    artifactVerified: true,
  }],
  evidence_origin: "deterministic",
  artifact_verified: true,
  provider: "public-web",
});

const tokenLead = (value = "TOKEN"): BasicFactLead => ({
  subject: "Founder Name",
  predicate: "official_token",
  value,
  questionId: "person.official_token",
  excerpt: `${value} is described as an official token candidate for the founder's venture.`,
  sourceUrl: `https://candidate.example/${value.toLowerCase()}`,
  evidence_origin: "model_lead",
  artifact_verified: false,
  provider: "claude-web-search",
});

function context(
  ledger: BasicFactQuestionLedgerEntry[],
  facts: BasicFact[] = [],
  leads: BasicFactLead[] = [],
): { ctx: CollectContext; observations: CheckObservation[] } {
  const evidence = emptyEvidence("@founder");
  evidence.roles = [SubjectClass.FOUNDER];
  evidence.basicFactQuestionLedger = ledger;
  evidence.basicFacts = facts;
  evidence.basicFactLeads = leads;
  const observations: CheckObservation[] = [];
  return {
    observations,
    ctx: {
      handle: "@founder",
      evidence,
      emit: () => undefined,
      recordCheck: (observation) => observations.push(observation),
    },
  };
}

function founderReadiness(assetObservation: CheckObservation) {
  const tracker = new PersonCheckTracker();
  for (const id of [
    "founder-identity-authority",
    "founder-company-relationships",
    "founder-track-record",
    "founder-control-conflicts",
    "founder-legal-regulatory",
  ] as const) {
    tracker.record({
      id,
      status: "confirmed",
      note: `${id} completed from frozen evidence`,
      provider: "test",
      sourceCount: 1,
    });
  }
  // The legal-grade decision gates a real founder audit always resolves. These
  // are decision-critical for every role, so a "fully answered" founder must
  // complete them before the asset check alone determines readiness.
  tracker.record({ id: "ofac-sanctions-name", status: "checked-empty", note: "no SDN match for the resolved name", provider: "ofac-sdn" });
  tracker.record({ id: "trust-graph-connections", status: "checked-empty", note: "no flagged-subject ties", provider: "trust-graph" });
  tracker.record(assetObservation);
  return deriveDecisionReadiness(tracker.snapshot([SubjectClass.FOUNDER], { resolvedRealName: true }));
}

describe("founder decision question outcomes", () => {
  it("records six investor-facing outcomes while preserving unanswered gaps", () => {
    const { ctx, observations } = context([
      run("official_identity", "answered"),
      run("current_role", "answered"),
      run("founder", "answered"),
      run("track_record", "answered"),
      run("exit", "unanswered", "completed_empty"),
      run("prior_role", "answered"),
      run("control", "unanswered", "completed_empty"),
      run("conflict_of_interest", "unanswered", "completed_empty"),
      run("governance", "unanswered", "completed_empty"),
      run("legal_regulatory_event", "answered"),
      run("public_security", "answered"),
      run("official_token", "unanswered", "completed_empty"),
    ], [
      fact("official_identity", "Brian Armstrong"),
      fact("current_role", "Coinbase chair and CEO"),
      fact("founder", "Coinbase"),
      fact("track_record", "Coinbase direct listing"),
      fact("legal_regulatory_event", "An attributed regulatory event with a stated status"),
      fact("public_security", "NASDAQ: COIN"),
    ]);

    collectFounderDecisionQuestionOutcomes(ctx);

    expect(observations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "founder-identity-authority", status: "confirmed" }),
      expect.objectContaining({ id: "founder-company-relationships", status: "confirmed" }),
      expect.objectContaining({ id: "founder-track-record", status: "confirmed" }),
      expect.objectContaining({ id: "founder-control-conflicts", status: "checked-empty", note: expect.stringContaining("gap, not a clean screen") }),
      expect.objectContaining({ id: "founder-legal-regulatory", status: "finding", sourceCount: 1 }),
      expect.objectContaining({
        id: "founder-asset-distinction",
        status: "confirmed",
        note: expect.stringMatching(/Public security: NASDAQ: COIN verified; Official crypto token: completed search found no verified asset/),
      }),
    ]));
    expect(observations).toHaveLength(6);
  });

  it.each([
    ["founded", "Aave Protocol founded in 2020"],
    ["product", "Aave Protocol"],
    ["launched", "Aave Protocol launched in 2020"],
    ["traction", "$20 billion supplied to Aave"],
  ] as const)("lets a verified %s artifact establish founder track record", (predicate, value) => {
    const { ctx, observations } = context([
      run(predicate, "answered"),
    ], [fact(predicate, value)]);

    collectFounderDecisionQuestionOutcomes(ctx);

    expect(observations).toEqual([
      expect.objectContaining({
        id: "founder-track-record",
        status: "confirmed",
        sourceCount: 1,
        note: expect.stringContaining("founded venture, shipped product, traction result"),
      }),
    ]);
  });

  it("keeps failed question passes unavailable instead of calling them an empty result", () => {
    const { ctx, observations } = context([
      run("legal_regulatory_event", "unanswered", "failed"),
    ]);

    collectFounderDecisionQuestionOutcomes(ctx);

    expect(observations).toEqual([
      expect.objectContaining({
        id: "founder-legal-regulatory",
        status: "unavailable",
        note: expect.stringContaining("partial, failed, or unavailable"),
      }),
    ]);
  });

  it("keeps a question whose targeted repair pass failed unavailable despite a succeeded batch run", () => {
    const entry = run("legal_regulatory_event", "unanswered", "succeeded");
    // The batch-level primary succeeded, then the repair-critical targeted
    // pass failed: last-run-wins, so this is a gap, not a completed screen.
    entry.providerRuns.push({ phase: "repair", provider: "claude-web-search", state: "failed" });
    const { ctx, observations } = context([entry]);

    collectFounderDecisionQuestionOutcomes(ctx);

    expect(observations).toEqual([
      expect.objectContaining({
        id: "founder-legal-regulatory",
        status: "unavailable",
        note: expect.stringContaining("partial, failed, or unavailable"),
      }),
    ]);
  });

  it("does not let a succeeded batch that left only unverified leads read as checked-empty", () => {
    const { ctx, observations } = context([
      run("legal_regulatory_event", "unanswered", "succeeded"),
    ]);

    collectFounderDecisionQuestionOutcomes(ctx);

    expect(observations).toEqual([
      expect.objectContaining({
        id: "founder-legal-regulatory",
        status: "unavailable",
      }),
    ]);
  });

  it("still records checked-empty when the final targeted pass explicitly completed empty", () => {
    const entry = run("legal_regulatory_event", "unanswered", "succeeded");
    entry.providerRuns.push({ phase: "repair", provider: "claude-web-search", state: "completed_empty" });
    const { ctx, observations } = context([entry]);

    collectFounderDecisionQuestionOutcomes(ctx);

    expect(observations).toEqual([
      expect.objectContaining({
        id: "founder-legal-regulatory",
        status: "checked-empty",
        note: expect.stringContaining("not legal clearance"),
      }),
    ]);
  });

  it("does not let a related-company legal event govern the founder legal check", () => {
    const related = {
      ...fact("legal_regulatory_event", "CFTC settlement"),
      attributedEntity: "Uniswap Labs",
      attributionScope: "related_entity" as const,
    };
    const { ctx, observations } = context([
      run("legal_regulatory_event", "answered"),
    ], [related]);

    collectFounderDecisionQuestionOutcomes(ctx);

    expect(observations).toEqual([
      expect.objectContaining({
        id: "founder-legal-regulatory",
        status: "checked-empty",
        sourceCount: 0,
        note: expect.stringContaining("not legal clearance"),
      }),
    ]);
  });

  it("keeps a Brian-shaped founder decision-ready when COIN is verified and no token claim or candidate was observed", () => {
    const { ctx, observations } = context([
      run("public_security", "answered"),
      run("official_token", "unanswered", "failed"),
    ], [fact("public_security", "NASDAQ: COIN")]);

    collectFounderDecisionQuestionOutcomes(ctx);

    expect(observations).toEqual([
      expect.objectContaining({
        id: "founder-asset-distinction",
        status: "confirmed",
        sourceCount: 1,
        note: expect.stringMatching(/Public security: NASDAQ: COIN verified; Official crypto token: not applicable because no claim or candidate was observed/),
      }),
    ]);
    expect(observations[0]?.note).toContain("not a provider-backed negative finding");
    expect(observations[0]?.note).not.toContain("completed search found no verified asset");
    expect(founderReadiness(observations[0])).toMatchObject({
      status: "ready",
      coveragePercent: 100,
      successful: 8,
      applicable: 8,
      unresolved: 0,
    });
  });

  it("marks asset classification not applicable when the frozen founder evidence contains no asset claim", () => {
    const { ctx, observations } = context([
      run("public_security", "unanswered", "failed"),
      run("official_token", "unanswered", "failed"),
    ]);

    collectFounderDecisionQuestionOutcomes(ctx);

    expect(observations).toEqual([
      expect.objectContaining({
        id: "founder-asset-distinction",
        status: "not-applicable",
        sourceCount: 0,
        note: expect.stringContaining("classification check does not govern readiness"),
      }),
    ]);
    expect(founderReadiness(observations[0])).toMatchObject({
      status: "ready",
      coveragePercent: 100,
      successful: 7,
      applicable: 7,
      unresolved: 0,
    });
  });

  it("keeps a person with an unresolved official-token candidate provisional", () => {
    const { ctx, observations } = context([
      run("public_security", "answered"),
      run("official_token", "unanswered", "failed"),
    ], [fact("public_security", "NASDAQ: COIN")], [tokenLead("BASE")]);

    collectFounderDecisionQuestionOutcomes(ctx);

    expect(observations).toEqual([
      expect.objectContaining({
        id: "founder-asset-distinction",
        status: "unavailable",
        note: expect.stringMatching(/Public security: NASDAQ: COIN verified; Official crypto token: unresolved/),
      }),
    ]);
    expect(observations[0]?.note).toContain("Each observed asset claim must be verified in its own category");
    expect(founderReadiness(observations[0])).toMatchObject({
      status: "provisional",
      coveragePercent: 87,
      successful: 7,
      applicable: 8,
      unresolved: 1,
    });
  });

  it("never treats the COIN stock symbol as proof that an identically named token candidate was resolved", () => {
    const { ctx, observations } = context([
      run("public_security", "answered"),
      run("official_token", "unanswered", "failed"),
    ], [fact("public_security", "NASDAQ: COIN")], [tokenLead("COIN")]);

    collectFounderDecisionQuestionOutcomes(ctx);

    expect(observations).toEqual([
      expect.objectContaining({
        id: "founder-asset-distinction",
        status: "unavailable",
        sourceCount: 1,
        note: expect.stringMatching(/Public security: NASDAQ: COIN verified; Official crypto token: unresolved/),
      }),
    ]);
  });

  it("does not apply the founder-only observation rule to a project report", () => {
    const { ctx, observations } = context([
      { ...run("public_security", "answered"), questionId: "project.public_security", audience: "project" },
      { ...run("official_token", "unanswered", "failed"), questionId: "project.official_token", audience: "project" },
    ], [fact("public_security", "NASDAQ: COIN")]);
    ctx.evidence.roles = [SubjectClass.PROJECT];

    collectFounderDecisionQuestionOutcomes(ctx);

    expect(observations).toEqual([]);
  });

  it.each([
    ["public_security", "NASDAQ: COIN", "official_token", /Public security: NASDAQ: COIN verified; Official crypto token: completed search found no verified asset/],
    ["official_token", "$UNI", "public_security", /Public security: completed search found no verified asset; Official crypto token: \$UNI verified/],
    ["official_token", "$FTT", "public_security", /Public security: completed search found no verified asset; Official crypto token: \$FTT verified/],
  ] as const)("keeps %s %s distinct from the other asset class", (verifiedPredicate, value, emptyPredicate, expectedNote) => {
    const { ctx, observations } = context([
      run(verifiedPredicate, "answered"),
      run(emptyPredicate, "unanswered", "completed_empty"),
    ], [fact(verifiedPredicate, value)]);

    collectFounderDecisionQuestionOutcomes(ctx);

    expect(observations).toEqual([
      expect.objectContaining({
        id: "founder-asset-distinction",
        status: "confirmed",
        note: expect.stringMatching(expectedNote),
      }),
    ]);
  });

  it("records two completed no-asset searches without inventing an asset", () => {
    const { ctx, observations } = context([
      run("public_security", "unanswered", "completed_empty"),
      run("official_token", "unanswered", "completed_empty"),
    ]);

    collectFounderDecisionQuestionOutcomes(ctx);

    expect(observations).toEqual([
      expect.objectContaining({
        id: "founder-asset-distinction",
        status: "checked-empty",
        sourceCount: 0,
        note: expect.stringMatching(/Public security: completed search found no verified asset; Official crypto token: completed search found no verified asset/),
      }),
    ]);
  });
});

describe("founder related-asset binding (ventureToken)", () => {
  const ventureToken = () => ({
    verified: true as const,
    verification: "official_x" as const,
    ventureName: "Aave",
    name: "Aave",
    symbol: "AAVE",
    coingeckoId: "aave",
    rank: 52,
    address: "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9",
    chain: "ethereum",
    officialX: "@aave",
    sourceUrl: "https://www.coingecko.com/en/coins/aave",
    capturedAt: "2026-07-14T00:00:00.000Z",
    providers: ["coingecko" as const],
  });

  it("resolves the token category from the verified venture token and confirms the check when the registry screen completed empty", () => {
    const securityEntry = run("public_security", "unanswered", "failed");
    // The completed SEC registry screen is recorded as the final run.
    securityEntry.providerRuns.push({ phase: "repair", provider: "sec-registry", state: "completed_empty" });
    const { ctx, observations } = context([
      securityEntry,
      run("official_token", "unanswered", "failed"),
    ], [], [tokenLead("AAVE")]);
    ctx.evidence.ventureToken = ventureToken();

    collectFounderDecisionQuestionOutcomes(ctx);

    expect(observations).toEqual([
      expect.objectContaining({
        id: "founder-asset-distinction",
        status: "confirmed",
        note: expect.stringMatching(/Official crypto token: \$AAVE verified/),
      }),
    ]);
    expect(founderReadiness(observations[0])).toMatchObject({ status: "ready" });
  });

  it("confirms when both categories resolve: a verified security fact plus the venture token", () => {
    const { ctx, observations } = context([
      run("public_security", "unanswered", "failed"),
      run("official_token", "unanswered", "failed"),
    ], [fact("public_security", "NASDAQ: COIN")], [tokenLead("AAVE")]);
    ctx.evidence.ventureToken = ventureToken();

    collectFounderDecisionQuestionOutcomes(ctx);

    expect(observations[0]).toEqual(expect.objectContaining({
      id: "founder-asset-distinction",
      status: "confirmed",
      note: expect.stringMatching(/Public security: NASDAQ: COIN verified; Official crypto token: \$AAVE verified/),
    }));
  });

  it("stays unavailable when neither category resolves despite an observed token lead", () => {
    const { ctx, observations } = context([
      run("public_security", "unanswered", "failed"),
      run("official_token", "unanswered", "failed"),
    ], [], [tokenLead("AAVE")]);

    collectFounderDecisionQuestionOutcomes(ctx);

    expect(observations[0]).toEqual(expect.objectContaining({
      id: "founder-asset-distinction",
      status: "unavailable",
    }));
  });
});

describe("deriveFounderVentureCandidate (venture ladder)", () => {
  const officialSource = (url: string) => ({
    url,
    sourceClass: "official_subject" as const,
    relation: "supports" as const,
    excerpt: "Stani Kulechov is CEO of Aave Labs.",
    contentHash: "c".repeat(64),
    capturedAt: "2026-07-14T00:00:00.000Z",
    provider: "public-web",
    artifactVerified: true as const,
  });
  const baseEvidence = () => {
    const evidence = emptyEvidence("@founder");
    evidence.roles = [SubjectClass.FOUNDER];
    evidence.profile = { ...evidence.profile, bio: "Founder & CEO @Aave" };
    return evidence;
  };

  it("rung 2: cleans role words from a current_role value with no 'at'", async () => {
    const { deriveFounderVentureCandidate } = await import("./orchestrate");
    const evidence = baseEvidence();
    evidence.basicFacts = [{
      ...fact("current_role", "Aave Labs CEO"),
      sources: [officialSource("https://aave.com/about")],
    }];
    const candidate = deriveFounderVentureCandidate(evidence);
    expect(candidate).toMatchObject({ project_name: "Aave Labs", x_handle: "@Aave", domain: "aave.com" });
  });

  it("rung 3: binds from an official-domain identity anchor plus the bio founder claim", async () => {
    const { deriveFounderVentureCandidate } = await import("./orchestrate");
    const evidence = baseEvidence();
    evidence.basicFacts = [{
      ...fact("official_identity", "Stani Kulechov"),
      sources: [officialSource("https://aave.com/about")],
    }];
    const candidate = deriveFounderVentureCandidate(evidence);
    expect(candidate).toMatchObject({ project_name: "Aave", x_handle: "@Aave", domain: "aave.com" });
  });

  it("derives nothing when the official anchor host disagrees with the bio handle", async () => {
    const { deriveFounderVentureCandidate } = await import("./orchestrate");
    const evidence = baseEvidence();
    evidence.basicFacts = [{
      ...fact("official_identity", "Stani Kulechov"),
      sources: [officialSource("https://stani.example/role")],
    }];
    expect(deriveFounderVentureCandidate(evidence)).toBeNull();
  });

  it("derives nothing from a press-only role fact with no bio agreement", async () => {
    const { deriveFounderVentureCandidate } = await import("./orchestrate");
    const evidence = baseEvidence();
    evidence.profile = { ...evidence.profile, bio: "building things" };
    evidence.basicFacts = [fact("current_role", "CEO at Aave Labs")];
    expect(deriveFounderVentureCandidate(evidence)).toBeNull();
  });
});
