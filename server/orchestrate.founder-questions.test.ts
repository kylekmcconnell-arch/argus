import { describe, expect, it } from "vitest";
import { SubjectClass } from "../src/engine";
import {
  emptyEvidence,
  type BasicFact,
  type BasicFactPredicate,
  type BasicFactQuestionLedgerEntry,
} from "../src/data/evidence";
import type { CheckObservation, CollectContext } from "./adapters/types";
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

function context(
  ledger: BasicFactQuestionLedgerEntry[],
  facts: BasicFact[] = [],
): { ctx: CollectContext; observations: CheckObservation[] } {
  const evidence = emptyEvidence("@founder");
  evidence.roles = [SubjectClass.FOUNDER];
  evidence.basicFactQuestionLedger = ledger;
  evidence.basicFacts = facts;
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

  it("does not let a verified stock close an unresolved token question", () => {
    const { ctx, observations } = context([
      run("public_security", "answered"),
      run("official_token", "unanswered", "failed"),
    ], [fact("public_security", "NASDAQ: COIN")]);

    collectFounderDecisionQuestionOutcomes(ctx);

    expect(observations).toEqual([
      expect.objectContaining({
        id: "founder-asset-distinction",
        status: "unavailable",
        note: expect.stringMatching(/Public security: NASDAQ: COIN verified; Official crypto token: unresolved/),
      }),
    ]);
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
