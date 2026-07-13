import { describe, expect, it, vi } from "vitest";
import { emptyEvidence, type BasicFact, type BasicFactPredicate } from "../src/data/evidence";
import { SubjectClass } from "../src/engine";
import type { CheckObservation, CollectContext } from "./adapters/types";
import { collectProjectCoreEvidenceOutcomes, recordProjectTokenDrawdownFinding } from "./orchestrate";

function context() {
  const evidence = emptyEvidence("@project");
  evidence.roles = [SubjectClass.PROJECT];
  const outcomes: CheckObservation[] = [];
  const ctx: CollectContext = {
    handle: "@project",
    evidence,
    emit: vi.fn(),
    recordCheck: (outcome) => outcomes.push(outcome),
  };
  return { ctx, evidence, outcomes };
}

function verifiedFact(predicate: BasicFactPredicate): BasicFact {
  return {
    factId: `fact-${predicate}`,
    subjectKey: "@project",
    predicate,
    value: `Project ${predicate} disclosure`,
    normalizedValue: `project ${predicate} disclosure`,
    status: "verified",
    critical: false,
    sources: [{
      url: `https://project.example/${predicate}`,
      sourceClass: "official_subject",
      relation: "supports",
      excerpt: `Project publishes its ${predicate} disclosure.`,
      contentHash: predicate.padEnd(64, "0").slice(0, 64),
      capturedAt: "2026-07-13T12:00:00.000Z",
      provider: "public-web",
      artifactVerified: true,
    }],
    evidence_origin: "deterministic",
    artifact_verified: true,
    provider: "public-web",
  };
}

describe("project core evidence outcomes", () => {
  it("freezes a severe canonical-token drawdown once without calling it misconduct", () => {
    const { evidence } = context();
    evidence.projectToken = {
      verified: true,
      verification: "official_x",
      name: "Drawdown Control",
      symbol: "DOWN",
      coingeckoId: "drawdown-control",
      rank: 500,
      address: "0x000000000000000000000000000000000000d000",
      chain: "ethereum",
      sourceUrl: "https://www.coingecko.com/en/coins/drawdown-control",
      capturedAt: "2026-07-12T17:00:00.000Z",
      providers: ["coingecko", "dexscreener"],
      history: {
        points: [1, 0.2],
        first: 1,
        last: 0.2,
        peak: 1,
        changePct: -80,
        drawdownPct: -80,
        timeframe: "day",
        poolAddress: "down-usdc-pool",
        sourceUrl: "https://api.geckoterminal.com/api/v2/networks/eth/pools/down-usdc-pool/ohlcv/day?aggregate=1&limit=90&currency=usd",
      },
    };

    expect(recordProjectTokenDrawdownFinding(evidence)).toBe(true);
    expect(recordProjectTokenDrawdownFinding(evidence)).toBe(false);
    expect(evidence.findings).toHaveLength(1);
    expect(evidence.findings[0]).toMatchObject({
      finding_type: "ProjectTokenDrawdown",
      verification_status: "Verified",
      polarity: -1,
      artifact_verified: true,
      independent_source_count: 1,
      source_author: "geckoterminal",
      source_url: "https://api.geckoterminal.com/api/v2/networks/eth/pools/down-usdc-pool/ohlcv/day?aggregate=1&limit=90&currency=usd",
    });
    expect(evidence.findings[0].claim).toContain("does not establish misconduct");

    evidence.findings = [];
    evidence.projectToken.history!.drawdownPct = -20;
    expect(recordProjectTokenDrawdownFinding(evidence)).toBe(false);
    expect(evidence.findings).toEqual([]);
  });

  it("confirms backing only from a verified first-party advisor or backer record", () => {
    const { ctx, evidence, outcomes } = context();
    evidence.webTeam = [
      {
        name: "Verified Advisor",
        role: "Strategic advisor",
        source: "team page",
        provider: "team-page",
        evidence_origin: "deterministic",
        artifact_verified: true,
      },
      {
        name: "Model Backer",
        role: "backer",
        source: "model search",
        provider: "grok",
        evidence_origin: "model_lead",
        artifact_verified: false,
      },
    ];

    expect(collectProjectCoreEvidenceOutcomes(ctx)).toMatchObject({
      state: "partial",
      detail: expect.stringContaining("1 verified backing record"),
    });
    expect(outcomes).toContainEqual(expect.objectContaining({
      id: "project-backing-partners",
      status: "confirmed",
      provider: "team-page",
      sourceCount: 1,
      note: expect.stringContaining("funding terms and institutional investment were not inferred"),
    }));
    expect(outcomes).toContainEqual(expect.objectContaining({
      id: "project-transparency",
      status: "unavailable",
      provider: "project-disclosure-collector",
    }));
  });

  it("records checked-empty after the bounded backing scan and excludes model leads plus ambiguous partner titles", () => {
    const { ctx, evidence, outcomes } = context();
    evidence.webTeam = [
      {
        name: "Search-only Backer",
        role: "backer",
        source: "model search",
        provider: "grok",
        evidence_origin: "model_lead",
        artifact_verified: false,
      },
      {
        name: "Product Partner",
        role: "ecosystem partner",
        source: "project account",
        provider: "twitterapi",
        evidence_origin: "deterministic",
        artifact_verified: true,
      },
    ];

    collectProjectCoreEvidenceOutcomes(ctx);

    expect(outcomes).toContainEqual(expect.objectContaining({
      id: "project-backing-partners",
      status: "checked-empty",
      provider: "project-core-evidence",
      note: expect.stringContaining("product partnerships require separate source verification"),
    }));
  });

  it("does not promote a verified canonical token into a transparency outcome", () => {
    const { ctx, evidence, outcomes } = context();
    evidence.projectToken = {
      verified: true,
      verification: "official_x",
      name: "Project Token",
      symbol: "PRJ",
      coingeckoId: "project-token",
      rank: 10,
      address: "TokenAddress",
      chain: "solana",
      sourceUrl: "https://www.coingecko.com/en/coins/project-token",
      capturedAt: "2026-07-12T17:00:00.000Z",
    };

    collectProjectCoreEvidenceOutcomes(ctx);

    const transparency = outcomes.find((outcome) => outcome.id === "project-transparency");
    expect(transparency).toMatchObject({
      status: "unavailable",
      provider: "project-disclosure-collector",
      note: expect.stringContaining("canonical token identity alone does not establish transparency"),
    });
  });

  it.each([
    "legal_entity",
    "governance",
    "tokenomics",
    "vesting",
    "treasury",
    "audit",
    "repository",
  ] satisfies BasicFactPredicate[])("confirms transparency from a verified %s fact", (predicate) => {
    const { ctx, evidence, outcomes } = context();
    evidence.basicFacts = [verifiedFact(predicate)];

    collectProjectCoreEvidenceOutcomes(ctx);

    expect(outcomes).toContainEqual(expect.objectContaining({
      id: "project-transparency",
      status: "confirmed",
      provider: "basic-facts-web",
      sourceCount: 1,
    }));
  });

  it("does not confirm transparency from an unresolved disclosure lead", () => {
    const { ctx, evidence, outcomes } = context();
    evidence.basicFacts = [{ ...verifiedFact("governance"), status: "lead" }];

    collectProjectCoreEvidenceOutcomes(ctx);

    expect(outcomes).toContainEqual(expect.objectContaining({
      id: "project-transparency",
      status: "unavailable",
    }));
    expect(outcomes).not.toContainEqual(expect.objectContaining({
      id: "project-transparency",
      status: "confirmed",
    }));
  });

  it("records checked-empty only when the disclosure provider returned an explicit no-match", () => {
    const { ctx, outcomes } = context();

    collectProjectCoreEvidenceOutcomes(ctx, { transparencySearchExplicitlyEmpty: true });

    expect(outcomes).toContainEqual(expect.objectContaining({
      id: "project-transparency",
      status: "checked-empty",
      provider: "basic-facts-web",
      note: expect.stringContaining("explicit no-match"),
    }));
  });

  it("does not record project outcomes for a non-project methodology", () => {
    const { ctx, evidence, outcomes } = context();
    evidence.roles = [SubjectClass.FOUNDER];

    expect(collectProjectCoreEvidenceOutcomes(ctx)).toEqual({
      state: "skipped",
      detail: "not a provider-backed project role",
    });
    expect(outcomes).toEqual([]);
  });
});
