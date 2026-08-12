import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyEvidence, type BasicFact, type CollectedEvidence } from "../data/evidence";
import { SubjectClass } from "../engine/taxonomy";
import { classifyProjectArchetypes } from "./archetypes";
import { buildPointInTimeIntelligence } from "./buildPointInTimeIntelligence";

const CAPTURED_AT = "2026-08-05T12:00:00.000Z";

function projectEvidence(handle = "@argusfixture"): CollectedEvidence {
  const evidence = emptyEvidence(handle);
  evidence.roles = [SubjectClass.PROJECT];
  evidence.profile.display_name = "Argus Fixture";
  return evidence;
}

function strictFact(
  value: string,
  overrides: Partial<BasicFact> = {},
): BasicFact {
  const factId = overrides.factId ?? `fact-${value.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return {
    factId,
    subjectKey: "@argusfixture",
    predicate: "product",
    value,
    normalizedValue: value.toLowerCase(),
    status: "verified",
    critical: true,
    sources: [{
      url: `https://example.test/${factId}`,
      title: "Official product documentation",
      sourceClass: "official_subject",
      relation: "supports",
      excerpt: value,
      contentHash: `hash-${factId}`,
      capturedAt: CAPTURED_AT,
      provider: "test",
      artifactVerified: true,
    }],
    evidence_origin: "deterministic",
    artifact_verified: true,
    provider: "public-web",
    ...overrides,
  };
}

function addCanonicalToken(evidence: CollectedEvidence): void {
  evidence.projectToken = {
    verified: true,
    verification: "official_x",
    name: "Fixture Token",
    symbol: "FIX",
    coingeckoId: "fixture",
    rank: null,
    address: "0x00000000000000000000000000000000000000aa",
    chain: "ethereum",
    sourceUrl: "https://market.example.test/fix",
    capturedAt: "2026-08-05T12:10:00.000Z",
    providers: ["coingecko"],
  };
}

function addProtocolTvl(evidence: CollectedEvidence): void {
  evidence.protocolTvl = {
    slug: "fixture",
    name: "Fixture",
    symbol: "FIX",
    tvlUsd: 20_000_000,
    chains: ["Ethereum", "Arbitrum"],
    chainBreakdown: [
      { chain: "Ethereum", tvlUsd: 18_000_000 },
      { chain: "Arbitrum", tvlUsd: 2_000_000 },
    ],
    geckoId: "fixture",
    change30dPct: -20,
    governanceIds: ["snapshot:fixture.eth"],
    sourceUrl: "https://defillama.example.test/protocol/fixture",
    capturedAt: "2026-08-05T12:20:00.000Z",
  };
}

function addObservedEvmControl(evidence: CollectedEvidence): void {
  evidence.evmControlReality = {
    schemaVersion: 1,
    state: "observed",
    chain: "ethereum",
    target: "0x00000000000000000000000000000000000000aa",
    mode: "point_in_time",
    scoringImpact: "none",
    chainIdentity: {
      id: "evm-chain-identity",
      method: "eth_chainId",
      providerHost: "rpc.example.test",
      expectedChain: "ethereum",
      expectedChainId: "0x1",
      state: "verified",
      observedChainId: "0x1",
      rawResult: "0x1",
    },
    capture: {
      blockNumber: 20_000_000,
      blockHash: "0xblockhash",
      blockTimestamp: "2026-08-05T12:15:00.000Z",
      providerHost: "rpc.example.test",
    },
    collection: { sourceClass: "direct_chain_rpc", rpcCalls: 8, modelCalls: 0, marginalUsd: 0 },
    targetCode: {
      address: "0x00000000000000000000000000000000000000aa",
      accountType: "contract",
      byteLength: 200,
      sha256Fingerprint: "code-hash",
      receiptId: "target-code",
    },
    proxy: {
      state: "standard_proxy_observed",
      indicators: ["erc_1967_implementation_slot"],
      implementationCandidates: [{
        address: "0x00000000000000000000000000000000000000bb",
        evidence: "erc_1967_implementation_slot",
        receiptIds: ["implementation-slot"],
      }],
      admin: {
        address: "0x00000000000000000000000000000000000000cc",
        receiptId: "admin-slot",
      },
    },
    ownerProbes: [],
    authorities: [{
      address: "0x00000000000000000000000000000000000000cc",
      relations: ["proxy_admin"],
      accountType: "no_code",
      receiptIds: ["admin-slot", "admin-code"],
      qualification: "standard_role_observation_not_complete_permission_map",
    }],
    safeCompatibleMultisigs: [{
      address: "0x00000000000000000000000000000000000000cc",
      state: "observed",
      owners: ["0x00000000000000000000000000000000000000dd"],
      threshold: 1,
      receiptIds: ["safe-owners", "safe-threshold"],
      qualification: "safe_compatible_interface_only",
    }],
    receipts: [{
      id: "target-code",
      method: "eth_getCode",
      target: "0x00000000000000000000000000000000000000aa",
      blockNumber: 20_000_000,
      blockHash: "0xblockhash",
      state: "returned",
      resultSha256: "code-hash",
      byteLength: 200,
    }],
    limitations: ["Custom roles are outside the bounded standard-interface read."],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("classifyProjectArchetypes", () => {
  it("routes only strict source-backed product facts", () => {
    const evidence = projectEvidence();
    evidence.profile.bio = "The largest DEX on earth";
    evidence.profile.display_name = "AMM Exchange";
    addCanonicalToken(evidence);
    evidence.projectToken!.name = "DEX Coin";
    evidence.basicFacts = [strictFact("A decentralized exchange and automated market maker")];

    const classification = classifyProjectArchetypes(evidence);

    expect(classification.forms).toEqual([{
      form: "token",
      evidenceState: "verified",
      sourceRefs: ["snapshot:project-token"],
    }]);
    expect(classification.archetypes).toMatchObject({ state: "resolved", primary: "dex" });
    expect(classification.archetypes.matches[0].sourceRefs).toEqual([
      `fact:${evidence.basicFacts[0].factId}:support:01`,
    ]);
  });

  it("does not route from names, bios, provider projections, or relaxed facts", () => {
    const evidence = projectEvidence();
    evidence.profile.bio = "DEX and bridge protocol";
    evidence.profile.display_name = "Stablecoin Bridge";
    addCanonicalToken(evidence);
    evidence.projectToken!.name = "Lending DEX";
    evidence.basicFacts = [
      strictFact("A decentralized exchange", { factId: "projection", providerProjection: true }),
      strictFact("A stablecoin", { factId: "relaxed", floorEligible: false }),
      strictFact("A bridge protocol", { factId: "lead", status: "lead" }),
    ];

    expect(classifyProjectArchetypes(evidence).archetypes).toEqual({
      state: "insufficient",
      primary: null,
      matches: [],
    });
  });

  it("keeps a hybrid uncollapsed and uses only a structural generic fallback", () => {
    const hybrid = projectEvidence();
    hybrid.basicFacts = [
      strictFact("A decentralized exchange", { factId: "dex" }),
      strictFact("A lending protocol", { factId: "lending" }),
    ];
    expect(classifyProjectArchetypes(hybrid).archetypes).toMatchObject({
      state: "hybrid",
      primary: null,
      matches: [{ archetype: "dex" }, { archetype: "lending" }],
    });

    const generic = projectEvidence();
    addProtocolTvl(generic);
    expect(classifyProjectArchetypes(generic).archetypes).toEqual({
      state: "generic",
      primary: "generic_protocol",
      matches: [{
        archetype: "generic_protocol",
        confidence: "structural_generic",
        sourceRefs: ["snapshot:protocol-tvl"],
      }],
    });
  });

  it("does not route an analytics or infrastructure vendor from the object it serves", () => {
    const examples = [
      "A crypto exchange data analytics platform",
      "A rollup infrastructure provider",
      "A cross-chain bridge analytics platform",
      "A cross-chain bridge security auditor",
      "A rollup compliance consultancy",
      "A crypto exchange cybersecurity auditor",
      "A stablecoin risk manager",
      "A derivatives recruitment agency",
    ];

    for (const [index, value] of examples.entries()) {
      const evidence = projectEvidence(`@vendor${index}`);
      evidence.basicFacts = [strictFact(value, { factId: `vendor-${index}`, subjectKey: `@vendor${index}` })];
      expect(classifyProjectArchetypes(evidence).archetypes, value).toEqual({
        state: "insufficient",
        primary: null,
        matches: [],
      });
    }
  });

  it("routes product-head descriptions while rejecting paired service vendors", () => {
    const pairs = [
      ["A crypto exchange platform", "exchange_or_custody"],
      ["A layer 2 scaling solution", "layer_2"],
      ["A cross-chain bridge protocol", "bridge"],
      ["A stablecoin issuer", "stablecoin"],
      ["A derivatives exchange", "derivatives"],
    ] as const;

    for (const [value, archetype] of pairs) {
      const evidence = projectEvidence();
      evidence.basicFacts = [strictFact(value)];
      expect(classifyProjectArchetypes(evidence).archetypes.matches, value)
        .toEqual(expect.arrayContaining([expect.objectContaining({ archetype })]));
    }
  });

  it("distinguishes a stablecoin issuer from products that merely serve stablecoins", () => {
    const issuer = projectEvidence();
    issuer.basicFacts = [strictFact("It issues a dollar-backed stablecoin")];
    expect(classifyProjectArchetypes(issuer).archetypes.primary).toBe("stablecoin");

    for (const value of ["A stablecoin lending protocol", "A DEX for stablecoin trading"]) {
      const evidence = projectEvidence();
      evidence.basicFacts = [strictFact(value)];
      expect(classifyProjectArchetypes(evidence).archetypes.matches, value)
        .not.toEqual(expect.arrayContaining([expect.objectContaining({ archetype: "stablecoin" })]));
    }
  });

  it("accepts a strictly corroborated direct-subject product fact", () => {
    const evidence = projectEvidence();
    evidence.basicFacts = [strictFact("A decentralized exchange", { status: "corroborated" })];

    expect(classifyProjectArchetypes(evidence).archetypes).toMatchObject({
      state: "resolved",
      primary: "dex",
    });
  });
});

describe("buildPointInTimeIntelligence", () => {
  it("returns null outside the PROJECT lane", () => {
    expect(buildPointInTimeIntelligence(emptyEvidence("@person"))).toBeNull();
  });

  it("is deterministic, does not read the wall clock, and does not mutate evidence", () => {
    const evidence = projectEvidence();
    addCanonicalToken(evidence);
    evidence.projectToken!.marketCapUsd = 50_000_000;
    evidence.projectToken!.fdvUsd = 100_000_000;
    evidence.projectToken!.circulatingSupply = 40;
    evidence.projectToken!.totalSupply = 100;
    const before = JSON.stringify(evidence);
    vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("wall clock access is forbidden");
    });

    const first = buildPointInTimeIntelligence(evidence);
    const second = buildPointInTimeIntelligence(evidence);

    expect(second).toEqual(first);
    expect(JSON.stringify(evidence)).toBe(before);
    expect(first?.captureWindow).toEqual({
      earliest: "2026-08-05T12:10:00.000Z",
      latest: "2026-08-05T12:10:00.000Z",
    });
    expect(first?.scoringImpact).toBe("none");
  });

  it("emits a fully resolvable lineage graph for a clean snapshot", () => {
    const evidence = projectEvidence();
    addCanonicalToken(evidence);
    evidence.basicFacts = [strictFact("A lending protocol", { factId: "clean-product" })];

    const snapshot = buildPointInTimeIntelligence(evidence)!;
    const sourceIds = new Set(snapshot.sources.map((source) => source.id));
    const measurementIds = new Set(snapshot.measurements.map((measurement) => measurement.id));
    const factIds = new Set(evidence.basicFacts.map((fact) => fact.factId));

    expect(snapshot.signals.find((signal) => signal.id === "intelligence_integrity_gap")).toBeUndefined();
    expect(sourceIds.size).toBe(snapshot.sources.length);
    expect(measurementIds.size).toBe(snapshot.measurements.length);
    expect(new Set(snapshot.questions.map((question) => question.id)).size).toBe(snapshot.questions.length);
    expect(new Set(snapshot.signals.map((signal) => signal.id)).size).toBe(snapshot.signals.length);

    for (const question of snapshot.questions) {
      expect(question.sourceRefs.every((sourceRef) => sourceIds.has(sourceRef)), question.id).toBe(true);
      expect(question.answerRefs.every((answerRef) =>
        measurementIds.has(answerRef)
        || factIds.has(answerRef)
        || (answerRef.startsWith("fact:") && factIds.has(answerRef.slice("fact:".length)))), question.id).toBe(true);
    }
    for (const signal of snapshot.signals) {
      if (signal.kind !== "coverage_gap") expect(signal.sourceRefs.length, signal.id).toBeGreaterThan(0);
      for (const measurementRef of signal.measurementRefs) {
        const measurement = snapshot.measurements.find((candidate) => candidate.id === measurementRef)!;
        expect(measurement.sourceRefs.every((sourceRef) => signal.sourceRefs.includes(sourceRef)), signal.id).toBe(true);
      }
      for (const receipt of signal.arithmetic ?? []) {
        expect(receipt.temporal, signal.id).toBeDefined();
        expect(receipt.temporal!.maxInputSkewHours, signal.id).toBeLessThanOrEqual(72);
        expect(receipt.inputMeasurementIds.every((measurementId) => signal.measurementRefs.includes(measurementId)), signal.id).toBe(true);
      }
    }
  });

  it("keeps exact profile chronology, site-response, prior-handle, and token-X receipts", () => {
    const evidence = projectEvidence();
    evidence.profile.website = "https://fixture.example.test";
    evidence.profile.site_substance_status = "coming_soon";
    evidence.profile.profile_collection_state = "resolved";
    evidence.profile.profile_provider = "twitterapi";
    evidence.profile.profile_captured_at = "2026-08-05T12:00:00.000Z";
    evidence.profile.last_post_at = "2026-08-01T08:00:00.000Z";
    evidence.profile.days_since_post = 4.2;
    evidence.profile.prior_handles = ["@old_fixture", "older_fixture"];
    addCanonicalToken(evidence);
    evidence.projectToken!.officialX = "argusfixture";

    const snapshot = buildPointInTimeIntelligence(evidence)!;
    const measurement = (id: string) => snapshot.measurements.find((candidate) => candidate.id === id);

    expect(measurement("last_observed_post_at")).toMatchObject({
      value: "2026-08-01T08:00:00.000Z",
      sourceRefs: ["snapshot:profile"],
    });
    expect(measurement("days_since_last_post")?.window?.asOf).toBe("2026-08-05T12:00:00.000Z");
    expect(measurement("official_site_response_state")).toMatchObject({ value: "coming_soon", evidenceState: "bounded" });
    expect(snapshot.sources.find((source) => source.id === "snapshot:official-site-response")?.excerpt)
      .toContain("does not establish that a product is live");
    expect(measurement("provider_reported_prior_handle_count")).toMatchObject({ value: 2 });
    expect(measurement("canonical_token_official_x")).toMatchObject({ value: "argusfixture" });
  });

  it("preserves every exact fact source, its original input path, and the full dated window", () => {
    const evidence = projectEvidence();
    const fact = strictFact("A lending protocol", { factId: "multi-source" });
    const template = fact.sources[0];
    fact.sources = [{
      ...template,
      url: "https://z.example.test/product",
      capturedAt: "2026-08-05T12:44:00.000Z",
      contentHash: "hash-z",
      provider: "provider-z",
    }, {
      ...template,
      url: "https://a.example.test/product",
      capturedAt: "2026-08-05T11:03:00.000Z",
      contentHash: "hash-a",
      provider: "provider-a",
    }];
    evidence.basicFacts = [fact];

    const snapshot = buildPointInTimeIntelligence(evidence);
    const sources = snapshot?.sources.filter((source) => source.factId === fact.factId);

    expect(sources).toEqual([
      expect.objectContaining({
        id: "fact:multi-source:support:01",
        inputPath: "basicFacts.0.sources.1",
        sourceUrl: "https://a.example.test/product",
        contentHashes: ["hash-a"],
      }),
      expect.objectContaining({
        id: "fact:multi-source:support:02",
        inputPath: "basicFacts.0.sources.0",
        sourceUrl: "https://z.example.test/product",
        contentHashes: ["hash-z"],
      }),
    ]);
    expect(snapshot?.captureWindow).toEqual({
      earliest: "2026-08-05T11:03:00.000Z",
      latest: "2026-08-05T12:44:00.000Z",
    });
  });

  it("withholds duplicate evidence identities and exposes the integrity failure", () => {
    const evidence = projectEvidence();
    evidence.basicFacts = [
      strictFact("A lending protocol", { factId: "duplicate-product" }),
      strictFact("A decentralized exchange", { factId: "duplicate-product" }),
    ];

    const snapshot = buildPointInTimeIntelligence(evidence)!;
    const sourceIds = new Set(snapshot.sources.map((source) => source.id));
    const measurementIds = new Set(snapshot.measurements.map((measurement) => measurement.id));
    const product = snapshot.questions.find((question) => question.id === "project.product");

    expect(snapshot.sources.some((source) => source.factId === "duplicate-product")).toBe(false);
    expect(snapshot.subject.archetypes).toMatchObject({ state: "insufficient", primary: null, matches: [] });
    expect(snapshot.questions.some((question) => question.id.startsWith("archetype."))).toBe(false);
    expect(product).toMatchObject({ state: "unresolved", answerRefs: [], sourceRefs: [] });
    expect(snapshot.signals.find((signal) => signal.id === "intelligence_integrity_gap"))
      .toMatchObject({ kind: "coverage_gap", severity: "high", polarity: "unknown" });

    for (const measurement of snapshot.measurements) {
      expect(measurement.sourceRefs.length, measurement.id).toBeGreaterThan(0);
      expect(measurement.sourceRefs.every((sourceRef) => sourceIds.has(sourceRef)), measurement.id).toBe(true);
      if (measurement.denominatorMeasurementId) {
        expect(measurementIds.has(measurement.denominatorMeasurementId), measurement.id).toBe(true);
      }
    }
    for (const signal of snapshot.signals) {
      expect(signal.sourceRefs.every((sourceRef) => sourceIds.has(sourceRef)), signal.id).toBe(true);
      expect(signal.measurementRefs.every((measurementRef) => measurementIds.has(measurementRef)), signal.id).toBe(true);
    }
  });

  it("preserves contradictory artifacts and keeps the affected question open", () => {
    const evidence = projectEvidence();
    const fact = strictFact("A lending protocol", { factId: "conflicted-product", status: "conflicted" });
    fact.sources.push({
      ...fact.sources[0],
      url: "https://counterparty.example.test/product",
      relation: "contradicts",
      excerpt: "The service is a data vendor and does not operate lending markets.",
      contentHash: "hash-contradiction",
      provider: "counterparty",
    });
    evidence.basicFacts = [fact];

    const snapshot = buildPointInTimeIntelligence(evidence);
    const question = snapshot?.questions.find((candidate) => candidate.id === "project.product");
    const conflict = snapshot?.signals.find((candidate) => candidate.id === "basic_fact_conflict:conflicted-product");

    expect(question).toMatchObject({ state: "partial" });
    expect(question?.sourceRefs).toEqual([
      "fact:conflicted-product:contradiction:01",
      "fact:conflicted-product:support:01",
    ]);
    expect(conflict?.sourceRefs).toEqual(question?.sourceRefs);
    expect(snapshot?.subject.archetypes.state).toBe("insufficient");
  });

  it("does not claim both sides exist when a conflicted fact has only support", () => {
    const evidence = projectEvidence();
    evidence.basicFacts = [strictFact("A lending protocol", {
      factId: "sparse-conflict-support-only",
      status: "conflicted",
    })];

    const snapshot = buildPointInTimeIntelligence(evidence);
    const question = snapshot?.questions.find((candidate) => candidate.id === "project.product");
    const gap = snapshot?.signals.find((candidate) =>
      candidate.id === "basic_fact_conflict_integrity_gap:sparse-conflict-support-only");

    expect(question).toMatchObject({ state: "partial" });
    expect(question?.basis).toContain("missing a saved contradicting artifact");
    expect(question?.basis).not.toContain("Saved sources conflict");
    expect(gap).toMatchObject({ kind: "coverage_gap", polarity: "unknown" });
    expect(gap?.finding).toContain("does not contain both sides");
    expect(gap?.finding).not.toContain("both support and contradict");
    expect(gap?.sourceRefs).toEqual(["fact:sparse-conflict-support-only:support:01"]);
  });

  it("does not claim both sides exist when a conflicted fact has only contradiction", () => {
    const evidence = projectEvidence();
    const fact = strictFact("A lending protocol", {
      factId: "sparse-conflict-contradiction-only",
      status: "conflicted",
    });
    fact.sources = [{ ...fact.sources[0], relation: "contradicts" }];
    evidence.basicFacts = [fact];

    const snapshot = buildPointInTimeIntelligence(evidence);
    const question = snapshot?.questions.find((candidate) => candidate.id === "project.product");
    const gap = snapshot?.signals.find((candidate) =>
      candidate.id === "basic_fact_conflict_integrity_gap:sparse-conflict-contradiction-only");

    expect(question).toMatchObject({ state: "partial" });
    expect(question?.basis).toContain("missing a saved supporting artifact");
    expect(gap?.sourceRefs).toEqual(["fact:sparse-conflict-contradiction-only:contradiction:01"]);
  });

  it("does not treat an unverified contradiction row as a conflict artifact", () => {
    const evidence = projectEvidence();
    const fact = strictFact("A lending protocol", {
      factId: "unverified-conflict-side",
      status: "conflicted",
    });
    fact.sources.push({
      ...fact.sources[0],
      relation: "contradicts",
      url: "https://counterparty.example.test/unverified",
      artifactVerified: false,
    } as unknown as BasicFact["sources"][number]);
    evidence.basicFacts = [fact];

    const snapshot = buildPointInTimeIntelligence(evidence);
    expect(snapshot?.signals.find((signal) => signal.id === "basic_fact_conflict:unverified-conflict-side"))
      .toBeUndefined();
    expect(snapshot?.signals.find((signal) => signal.id === "basic_fact_conflict_integrity_gap:unverified-conflict-side"))
      .toBeDefined();
    expect(snapshot?.sources.find((source) => source.id === "fact:unverified-conflict-side:contradiction:01"))
      .toMatchObject({ evidenceState: "reported_context" });
  });

  it("excludes related-entity facts from direct sources, routing, and question answers", () => {
    const evidence = projectEvidence();
    const related = strictFact("A decentralized exchange", {
      factId: "related-product",
      attributionScope: "related_entity",
      subjectKey: "@portfolio-company",
    });
    evidence.basicFacts = [related];
    evidence.basicFactQuestionLedger = [{
      questionId: "project.product",
      audience: "project",
      batch: "identity",
      predicate: "product",
      question: "What is the project product?",
      critical: true,
      status: "answered",
      answerRefs: [related.factId, `fact:${related.factId}`],
      providerRuns: [{ phase: "primary", provider: "test", state: "succeeded" }],
    }];

    const snapshot = buildPointInTimeIntelligence(evidence);
    const question = snapshot?.questions.find((candidate) => candidate.id === "project.product");

    expect(snapshot?.sources.some((source) => source.factId === related.factId)).toBe(false);
    expect(snapshot?.subject.archetypes.state).toBe("insufficient");
    expect(question).toMatchObject({ state: "unresolved", answerRefs: [], sourceRefs: [] });
    expect(snapshot?.signals.some((signal) => signal.id.includes(related.factId))).toBe(false);
  });

  it("excludes a direct-scoped fact whose subject key belongs to another handle", () => {
    const evidence = projectEvidence("@subject");
    evidence.profile.display_name = "Same Project Name";
    const wrongSubject = strictFact("A decentralized exchange", {
      factId: "wrong-subject-product",
      subjectKey: "@other",
      attributionScope: "direct_subject",
      questionId: "project.product",
    });
    evidence.basicFacts = [wrongSubject];
    evidence.basicFactQuestionLedger = [{
      questionId: "project.product",
      audience: "project",
      batch: "identity",
      predicate: "product",
      question: "What is the project product?",
      critical: true,
      status: "answered",
      answerRefs: [wrongSubject.factId],
      providerRuns: [{ phase: "primary", provider: "test", state: "succeeded" }],
    }];

    const snapshot = buildPointInTimeIntelligence(evidence);

    expect(snapshot?.sources.some((source) => source.factId === wrongSubject.factId)).toBe(false);
    expect(snapshot?.subject.archetypes.state).toBe("insufficient");
    expect(snapshot?.signals.find((signal) => signal.id === "strict_product_description")).toBeUndefined();
    expect(snapshot?.questions.find((question) => question.id === "project.product"))
      .toMatchObject({ state: "unresolved", answerRefs: [], sourceRefs: [] });
  });

  it("requires a ledger answer fact to match the question predicate exactly", () => {
    for (const join of ["answer_ref", "question_id"] as const) {
      const evidence = projectEvidence();
      const product = strictFact("A lending protocol", {
        factId: `wrong-predicate-${join}`,
        ...(join === "question_id" ? { questionId: "project.identity" } : {}),
      });
      evidence.basicFacts = [product];
      evidence.basicFactQuestionLedger = [{
        questionId: "project.identity",
        audience: "project",
        batch: "identity",
        predicate: "official_identity",
        question: "Which exact identity is official?",
        critical: true,
        status: "answered",
        answerRefs: join === "answer_ref" ? [product.factId] : [],
        providerRuns: [{ phase: "primary", provider: "test", state: "succeeded" }],
      }];

      const question = buildPointInTimeIntelligence(evidence)?.questions
        .find((candidate) => candidate.id === "project.identity");

      expect(question, join).toMatchObject({ state: "unresolved", answerRefs: [] });
      expect(question?.sourceRefs, join).toEqual([]);
    }
  });

  it("keeps profile identity capture separate from official X account-state capture", () => {
    const evidence = projectEvidence();
    evidence.profile.profile_collection_state = "resolved";
    evidence.profile.profile_provider = "twitterapi";
    evidence.profile.profile_captured_at = "2026-08-05T09:00:00.000Z";
    evidence.profile.x_account_status = "suspended";
    evidence.profile.x_account_status_source_url = "https://x.com/argusfixture";
    evidence.profile.x_account_status_captured_at = "2026-08-05T09:30:00.000Z";

    const snapshot = buildPointInTimeIntelligence(evidence);

    expect(snapshot?.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "snapshot:profile", capturedAt: "2026-08-05T09:00:00.000Z" }),
      expect.objectContaining({ id: "snapshot:x-account-status", capturedAt: "2026-08-05T09:30:00.000Z" }),
    ]));
    expect(snapshot?.captureWindow).toEqual({
      earliest: "2026-08-05T09:00:00.000Z",
      latest: "2026-08-05T09:30:00.000Z",
    });
  });

  it("keeps missing observations missing and still emits all four lenses", () => {
    const snapshot = buildPointInTimeIntelligence(projectEvidence());

    expect(snapshot).not.toBeNull();
    expect(snapshot?.measurements).toEqual([]);
    expect(snapshot?.signals).toEqual([]);
    expect(snapshot?.lenses.map((lens) => lens.id)).toEqual([
      "investment",
      "alpha_research",
      "counterparty",
      "general_diligence",
    ]);
    expect(snapshot?.questions.find((question) => question.id === "project.treasury")?.state).toBe("not_collected");
    expect(snapshot?.coverage.find((domain) => domain.domain === "treasury")?.state).toBe("not_collected");
    expect(JSON.stringify(snapshot)).not.toMatch(/NaN|Infinity/);
  });

  it("does not use an unrelated same-domain measurement to answer a critical question", () => {
    const evidence = projectEvidence();
    addCanonicalToken(evidence);
    evidence.projectToken!.circulatingSupply = 40;
    evidence.projectToken!.totalSupply = 100;

    const snapshot = buildPointInTimeIntelligence(evidence);
    const tokenomics = snapshot?.questions.find((question) => question.id === "project.tokenomics");
    const vesting = snapshot?.questions.find((question) => question.id === "project.vesting");

    expect(tokenomics).toMatchObject({
      state: "partial",
      answerRefs: ["circulating_supply", "circulating_supply_pct", "total_supply"],
    });
    expect(vesting).toMatchObject({ state: "not_collected", answerRefs: [] });
    expect(snapshot?.coverage.find((domain) => domain.domain === "supply"))
      .toMatchObject({ state: "partial" });
  });

  it("suppresses concentration when holder distribution was not assessed", () => {
    const evidence = projectEvidence();
    addCanonicalToken(evidence);
    evidence.projectToken!.marketCapUsd = 100_000_000;
    evidence.projectToken!.liquidityUsd = 1_000_000;
    evidence.holderProfile = {
      binding: { canonicalAddress: evidence.projectToken!.address, chain: evidence.projectToken!.chain, method: "canonical_token_address_chain" },
      topHolderPct: 90,
      top10Pct: 99,
      holderCount: 12,
      lpLockedOrBurnedPct: null,
      holdersAssessed: false,
      distributionSource: null,
      distributionNote: "Provider register was unusable",
      sourceUrl: "https://goplus.example.test/token",
      capturedAt: "2026-08-05T12:30:00.000Z",
    };

    const snapshot = buildPointInTimeIntelligence(evidence);

    expect(snapshot?.measurements.find((measurement) => measurement.id === "holder_count")).toBeDefined();
    expect(snapshot?.measurements.find((measurement) => measurement.id === "top_10_holder_pct")).toBeUndefined();
    expect(snapshot?.signals.find((signal) => signal.id === "concentrated_exit_surface")).toBeUndefined();
  });

  it("publishes a short holder register as a structural floor, never a top-10 measurement", () => {
    const evidence = projectEvidence();
    addCanonicalToken(evidence);
    evidence.projectToken!.marketCapUsd = 100_000_000;
    evidence.projectToken!.liquidityUsd = 5_000_000;
    evidence.holderProfile = {
      binding: { canonicalAddress: evidence.projectToken!.address, chain: evidence.projectToken!.chain, method: "canonical_token_address_chain" },
      topHolderPct: 30,
      top10Pct: 60,
      assessedWalletCount: 4,
      top10PctIsFloor: true,
      holderCount: 12_000,
      lpLockedOrBurnedPct: null,
      holdersAssessed: true,
      distributionSource: "goplus",
      distributionNote: "The aggregate is a floor across 4 assessed wallets.",
      contractFlags: [],
      creatorPct: null,
      sourceUrl: "https://goplus.example.test/token",
      sourceCapturedAt: "2026-08-05T12:30:00.000Z",
      capturedAt: "2026-08-05T12:30:00.000Z",
    };

    const snapshot = buildPointInTimeIntelligence(evidence);
    const floor = snapshot?.measurements.find((measurement) => measurement.id === "assessed_wallet_share_floor_pct");
    const count = snapshot?.measurements.find((measurement) => measurement.id === "assessed_wallet_count");
    const signal = snapshot?.signals.find((candidate) => candidate.id === "concentrated_exit_surface");

    expect(floor).toMatchObject({ value: 60, label: "Minimum combined share across 4 assessed wallets" });
    expect(count).toMatchObject({ value: 4 });
    expect(snapshot?.measurements.find((measurement) => measurement.id === "top_10_holder_pct")).toBeUndefined();
    expect(signal?.finding).toContain("at least 60% of supply across 4 assessed wallets");
    expect(signal?.finding).not.toMatch(/top 10 assessed wallets/i);
    expect(signal?.measurementRefs).toContain("assessed_wallet_count");
    expect(signal?.arithmetic?.[0]?.temporal).toMatchObject({
      state: "aligned",
      maxInputSkewHours: 0.3333,
    });
    expect(snapshot?.sources.find((source) => source.id === "snapshot:holder-profile")?.excerpt)
      .toContain("floor and not a top-10 total");
  });

  it("binds market, liquidity, history, and holder measurements to their exact producers", () => {
    const evidence = projectEvidence();
    addCanonicalToken(evidence);
    evidence.projectToken!.producerSources = {
      identity: { provider: "official_site", sourceUrl: "https://fixture.example.test/token", capturedAt: "2026-08-05T10:00:00.000Z" },
      market: { provider: "coingecko", sourceUrl: "https://api.coingecko.test/fixture", capturedAt: "2026-08-05T10:01:00.000Z", providerUpdatedAt: "2026-08-05T09:58:00.000Z" },
      liquidity: { provider: "dexscreener", sourceUrl: "https://api.dexscreener.test/pair", capturedAt: "2026-08-05T10:02:00.000Z" },
      history: { provider: "geckoterminal", sourceUrl: "https://api.geckoterminal.test/ohlcv", capturedAt: "2026-08-05T10:03:00.000Z" },
    };
    evidence.projectToken!.marketCapUsd = 100_000_000;
    evidence.projectToken!.liquidityUsd = 5_000_000;
    evidence.projectToken!.history = {
      points: [1, 1.2],
      first: 1,
      last: 1.2,
      peak: 1.2,
      changePct: 20,
      drawdownPct: 0,
      spanPeriods: 1,
      windowIsPartial: false,
      volume: {
        recent: { usd: 200, candles: 1, measured: 1 },
        prior: { usd: 100, candles: 1, measured: 1 },
        changePct: 100,
        isFloor: false,
      },
      timeframe: "day",
      poolAddress: "0xpool",
      sourceUrl: "https://api.geckoterminal.test/ohlcv",
      capturedAt: "2026-08-05T10:03:00.000Z",
    };
    evidence.holderProfile = {
      binding: { canonicalAddress: evidence.projectToken!.address, chain: evidence.projectToken!.chain, method: "canonical_token_address_chain" },
      topHolderPct: 12,
      top10Pct: 55,
      assessedWalletCount: 10,
      top10PctIsFloor: false,
      holderCount: 5_000,
      lpLockedOrBurnedPct: 80,
      holdersAssessed: true,
      distributionSource: "explorer",
      distributionNote: "Explorer returned an ordered register.",
      distributionSourceUrl: "https://blockscout.test/token/holders",
      distributionCapturedAt: "2026-08-05T10:04:00.000Z",
      contractFlags: [],
      creatorPct: null,
      sourceUrl: "https://goplus.test/token",
      sourceCapturedAt: "2026-08-05T10:04:30.000Z",
      capturedAt: "2026-08-05T10:04:30.000Z",
    };

    const snapshot = buildPointInTimeIntelligence(evidence);
    const sourceRefs = (id: string) => snapshot?.measurements.find((measurement) => measurement.id === id)?.sourceRefs;

    expect(sourceRefs("market_cap_usd")).toEqual(["snapshot:project-token-market"]);
    expect(sourceRefs("liquidity_usd")).toEqual(["snapshot:project-token-liquidity"]);
    expect(sourceRefs("price_window_change_pct")).toEqual(["snapshot:project-token-history"]);
    expect(sourceRefs("price_window_volume_change_pct")).toEqual(["snapshot:project-token-history"]);
    expect(sourceRefs("holder_count")).toEqual(["snapshot:holder-profile"]);
    expect(sourceRefs("top_10_holder_pct")).toEqual(["snapshot:holder-distribution"]);
    expect(snapshot?.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "snapshot:project-token-market", provider: "coingecko", providerUpdatedAt: "2026-08-05T09:58:00.000Z" }),
      expect.objectContaining({ id: "snapshot:project-token-liquidity", provider: "dexscreener" }),
      expect.objectContaining({ id: "snapshot:project-token-history", provider: "geckoterminal" }),
      expect.objectContaining({ id: "snapshot:holder-distribution", provider: "blockscout" }),
    ]));
  });

  it("retains an unverified token candidate as a bounded receipt without token intelligence", () => {
    const evidence = projectEvidence();
    addCanonicalToken(evidence);
    evidence.projectToken!.priceUsd = 99;
    evidence.projectToken!.marketCapUsd = 9_900_000_000;
    evidence.projectToken = {
      ...evidence.projectToken!,
      verified: false,
    } as unknown as NonNullable<CollectedEvidence["projectToken"]>;

    const snapshot = buildPointInTimeIntelligence(evidence);
    const gap = snapshot?.signals.find((signal) => signal.id === "canonical_token_identity_unverified");

    expect(snapshot?.subject.forms.find((form) => form.form === "token")).toBeUndefined();
    expect(snapshot?.measurements.find((measurement) => measurement.id === "token_price_usd")).toBeUndefined();
    expect(snapshot?.measurements.find((measurement) => measurement.id === "market_cap_usd")).toBeUndefined();
    expect(snapshot?.sources.find((source) => source.id === "snapshot:project-token"))
      .toMatchObject({ evidenceState: "bounded", title: "Unverified canonical-token candidate receipt" });
    expect(gap).toMatchObject({ kind: "coverage_gap", severity: "high", domain: "identity" });
    expect(gap?.measurementRefs).toEqual([]);
  });

  it("withholds an impossible circulating-supply percentage and emits reconciliation gaps", () => {
    const cases = [
      { circulatingSupply: -1, totalSupply: 100, label: "negative numerator" },
      { circulatingSupply: 10, totalSupply: 0, label: "nonpositive denominator" },
      { circulatingSupply: 150, totalSupply: 100, label: "numerator above denominator" },
    ];

    for (const testCase of cases) {
      const evidence = projectEvidence();
      addCanonicalToken(evidence);
      evidence.projectToken!.circulatingSupply = testCase.circulatingSupply;
      evidence.projectToken!.totalSupply = testCase.totalSupply;

      const snapshot = buildPointInTimeIntelligence(evidence);
      const gap = snapshot?.signals.find((signal) => signal.id === "circulating_supply_reconciliation_gap");

      expect(snapshot?.measurements.find((measurement) => measurement.id === "circulating_supply_pct"), testCase.label).toBeUndefined();
      expect(snapshot?.signals.find((signal) => signal.id === "reported_supply_overhang"), testCase.label).toBeUndefined();
      expect(gap, testCase.label).toMatchObject({ kind: "coverage_gap", severity: "high", measurementRefs: [] });
      expect(gap?.finding, testCase.label).toContain("cannot exceed total supply");
    }
  });

  it("withholds impossible unlock percentages but retains the bound schedule receipts", () => {
    const evidence = projectEvidence();
    addCanonicalToken(evidence);
    evidence.projectToken!.liquidityUsd = 2_000_000;
    evidence.tokenUnlocks = {
      nextUnlockDate: "2026-09-01T00:00:00.000Z",
      allocationName: "Team",
      percentOfSupply: 120,
      unlockValueUsd: 1_000_000,
      percentOfMcap: -5,
      cumulativeUnlockedPercent: 101,
      next90dPercentOfSupply: 180,
      canonicalAddress: evidence.projectToken!.address,
      chain: evidence.projectToken!.chain,
      currencyId: 42,
      contractSourceUrl: "https://api.cryptorank.example.test/currencies/contracts",
      eventsSourceUrl: "https://api.cryptorank.example.test/currencies/42/vesting",
      percentageValidation: {
        invalidFields: ["percentOfSupply", "percentOfMcap", "cumulativeUnlockedPercent", "next90dPercentOfSupply"],
      },
      sourceUrl: "https://cryptorank.example.test/fix/vesting",
      capturedAt: "2026-08-05T12:50:00.000Z",
    };

    const snapshot = buildPointInTimeIntelligence(evidence);
    const ids = new Set(snapshot?.measurements.map((measurement) => measurement.id));
    const gap = snapshot?.signals.find((signal) => signal.id === "token_unlock_percentage_reconciliation_gap");

    expect(ids.has("next_unlock_date")).toBe(true);
    expect(ids.has("next_unlock_usd")).toBe(true);
    expect(ids.has("next_unlock_supply_pct")).toBe(false);
    expect(ids.has("next_unlock_market_cap_pct")).toBe(false);
    expect(ids.has("cumulative_unlocked_pct")).toBe(false);
    expect(ids.has("next_90d_unlock_supply_pct")).toBe(false);
    expect(gap).toMatchObject({ kind: "coverage_gap", severity: "high", measurementRefs: [] });
    expect(gap?.finding).toContain("90-day aggregate above 100%");
    expect(gap?.sourceRefs).toEqual([
      "snapshot:token-unlock-contract-map",
      "snapshot:token-unlock-events",
      "snapshot:token-unlocks",
    ]);
  });

  it("withholds namesake protocol rows and every downstream fee, incident, and funding claim", () => {
    const evidence = projectEvidence();
    addCanonicalToken(evidence);
    addProtocolTvl(evidence);
    evidence.protocolTvl!.geckoId = "namesake-token";
    evidence.protocolTvl!.hacks = [{
      date: "2025-01-01",
      amountUsd: 500_000_000,
      returnedFunds: false,
      classification: "exploit",
    }];
    evidence.protocolFunding = {
      slug: "fixture",
      name: "Namesake Fixture",
      geckoId: "namesake-token",
      rounds: [{ date: "2025-01-01", round: "Series Z", amountUsd: 1_000_000_000, leadInvestors: ["Wrong Fund"], otherInvestors: [], valuationUsd: 10_000_000_000 }],
      totalRaisedUsd: 1_000_000_000,
      leadInvestors: ["Wrong Fund"],
      sourceUrl: "https://defillama.example.test/raises/namesake",
      capturedAt: "2026-08-05T12:30:00.000Z",
    };
    evidence.protocolFees = {
      slug: "fixture",
      binding: { canonicalGeckoId: "fixture", protocolSlug: "fixture", method: "matched_protocol_gecko_id" },
      total24hUsd: 10_000_000,
      total30dUsd: 300_000_000,
      sourceUrl: "https://defillama.example.test/fees/namesake",
      capturedAt: "2026-08-05T12:31:00.000Z",
    };

    const snapshot = buildPointInTimeIntelligence(evidence);
    const ids = new Set(snapshot?.measurements.map((measurement) => measurement.id));

    expect(snapshot?.subject.forms.map((form) => form.form)).toEqual(["token"]);
    expect(ids.has("tvl_usd")).toBe(false);
    expect(ids.has("largest_recorded_incident_usd")).toBe(false);
    expect(ids.has("funding_round_count")).toBe(false);
    expect(ids.has("protocol_fees_30d_usd")).toBe(false);
    expect(snapshot?.signals).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "protocol_tvl_identity_mismatch", severity: "high" }),
      expect.objectContaining({ id: "protocol_funding_identity_mismatch", severity: "high" }),
      expect.objectContaining({ id: "protocol_fees_identity_unbound", severity: "high" }),
    ]));
    expect(snapshot?.signals.find((signal) => signal.id === "recorded_incident_scale")).toBeUndefined();
    expect(snapshot?.signals.find((signal) => signal.id === "disclosed_capital_to_fee_scale")).toBeUndefined();
    expect(snapshot?.sources.find((source) => source.id === "snapshot:protocol-tvl")?.evidenceState).toBe("bounded");
    expect(snapshot?.sources.find((source) => source.id === "snapshot:protocol-funding")?.evidenceState).toBe("bounded");
    expect(snapshot?.sources.find((source) => source.id === "snapshot:protocol-fees")?.evidenceState).toBe("bounded");
  });

  it("requires the structured fee receipt even when the protocol row itself is matched", () => {
    const evidence = projectEvidence();
    addCanonicalToken(evidence);
    addProtocolTvl(evidence);
    evidence.protocolFees = {
      slug: "fixture",
      total24hUsd: 50_000,
      total30dUsd: 1_500_000,
      sourceUrl: "https://defillama.example.test/fees/fixture",
      capturedAt: "2026-08-05T12:31:00.000Z",
    };

    const snapshot = buildPointInTimeIntelligence(evidence);
    const gap = snapshot?.signals.find((signal) => signal.id === "protocol_fees_identity_unbound");

    expect(snapshot?.measurements.find((measurement) => measurement.id === "tvl_usd")).toBeDefined();
    expect(snapshot?.measurements.find((measurement) => measurement.id === "protocol_fees_30d_usd")).toBeUndefined();
    expect(snapshot?.signals.find((signal) => signal.id === "protocol_fee_intensity")).toBeUndefined();
    expect(gap).toMatchObject({ severity: "high", measurementRefs: [], sourceRefs: ["snapshot:protocol-fees"] });
    expect(gap?.finding).toContain("lacks a complete binding");
  });

  it("withholds mismatched holder, unlock, and EVM sidecars despite plausible values", () => {
    const evidence = projectEvidence();
    addCanonicalToken(evidence);
    evidence.projectToken!.liquidityUsd = 2_000_000;
    evidence.projectToken!.volume24hUsd = 4_000_000;
    const wrongAddress = "0x00000000000000000000000000000000000000bb";
    evidence.holderProfile = {
      binding: { canonicalAddress: wrongAddress, chain: "ethereum", method: "canonical_token_address_chain" },
      topHolderPct: 90,
      top10Pct: 99,
      assessedWalletCount: 10,
      top10PctIsFloor: false,
      holderCount: 100_000,
      lpLockedOrBurnedPct: 100,
      holdersAssessed: true,
      distributionSource: "goplus",
      contractFlags: [{ key: "mint_authority_active", claim: "The unrelated contract can mint.", tone: "bad", source: "goplus" }],
      creatorPct: 80,
      sourceUrl: "https://goplus.example.test/wrong-token",
      capturedAt: "2026-08-05T12:30:00.000Z",
    };
    evidence.tokenUnlocks = {
      nextUnlockDate: "2026-09-01T00:00:00.000Z",
      allocationName: "Team",
      percentOfSupply: 50,
      unlockValueUsd: 1_000_000_000,
      percentOfMcap: 500,
      cumulativeUnlockedPercent: 10,
      next90dPercentOfSupply: 80,
      canonicalAddress: wrongAddress,
      chain: "ethereum",
      currencyId: 42,
      contractSourceUrl: "https://api.cryptorank.example.test/currencies/contracts",
      eventsSourceUrl: "https://api.cryptorank.example.test/currencies/42/vesting",
      sourceUrl: "https://cryptorank.example.test/wrong/vesting",
      capturedAt: "2026-08-05T12:50:00.000Z",
    };
    addObservedEvmControl(evidence);
    evidence.evmControlReality!.target = wrongAddress;

    const snapshot = buildPointInTimeIntelligence(evidence);
    const ids = new Set(snapshot?.measurements.map((measurement) => measurement.id));

    expect(ids.has("holder_count")).toBe(false);
    expect(ids.has("top_10_holder_pct")).toBe(false);
    expect(ids.has("next_unlock_usd")).toBe(false);
    expect(ids.has("evm_control_target_state")).toBe(false);
    expect(snapshot?.signals).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "holder_profile_identity_unbound", severity: "high" }),
      expect.objectContaining({ id: "token_unlock_identity_unbound", severity: "high" }),
      expect.objectContaining({ id: "evm_control_identity_mismatch", severity: "high" }),
    ]));
    expect(snapshot?.signals.find((signal) => signal.id.startsWith("goplus_contract_flag:"))).toBeUndefined();
    expect(snapshot?.signals.find((signal) => signal.id === "unlock_absorption_surface")).toBeUndefined();
    expect(snapshot?.signals.find((signal) => signal.id === "evm_standard_proxy_observed")).toBeUndefined();
    expect(snapshot?.sources.find((source) => source.id === "snapshot:holder-profile")?.evidenceState).toBe("bounded");
    expect(snapshot?.sources.find((source) => source.id === "snapshot:token-unlocks")?.evidenceState).toBe("bounded");
    expect(snapshot?.sources.find((source) => source.id === "snapshot:evm-control-reality")?.evidenceState).toBe("bounded");
  });

  it("accepts case and whitespace normalization only when every producer identity remains exact", () => {
    const evidence = projectEvidence();
    addCanonicalToken(evidence);
    addProtocolTvl(evidence);
    evidence.protocolTvl!.geckoId = " FIXTURE ";
    evidence.protocolFees = {
      slug: " Fixture ",
      binding: { canonicalGeckoId: " FIXTURE ", protocolSlug: " fixture ", method: "matched_protocol_gecko_id" },
      total24hUsd: 10_000,
      total30dUsd: 300_000,
      sourceUrl: "https://defillama.example.test/fees/fixture",
      capturedAt: "2026-08-05T12:31:00.000Z",
    };
    evidence.holderProfile = {
      binding: { canonicalAddress: evidence.projectToken!.address.toUpperCase(), chain: " Ethereum ", method: "canonical_token_address_chain" },
      topHolderPct: null,
      top10Pct: null,
      holderCount: 1_000,
      lpLockedOrBurnedPct: null,
      holdersAssessed: false,
      distributionSource: null,
      sourceUrl: "https://goplus.example.test/token",
      capturedAt: "2026-08-05T12:30:00.000Z",
    };
    evidence.tokenUnlocks = {
      nextUnlockDate: "2026-09-01T00:00:00.000Z",
      allocationName: "Team",
      percentOfSupply: 2,
      unlockValueUsd: 1_000_000,
      percentOfMcap: 5,
      cumulativeUnlockedPercent: 40,
      next90dPercentOfSupply: 6,
      canonicalAddress: evidence.projectToken!.address.toUpperCase(),
      chain: " Ethereum ",
      currencyId: 42,
      contractSourceUrl: "https://api.cryptorank.example.test/currencies/contracts",
      eventsSourceUrl: "https://api.cryptorank.example.test/currencies/42/vesting",
      sourceUrl: "https://cryptorank.example.test/fix/vesting",
      capturedAt: "2026-08-05T12:50:00.000Z",
    };
    addObservedEvmControl(evidence);
    evidence.evmControlReality!.target = evidence.projectToken!.address.toUpperCase();
    evidence.evmControlReality!.chain = " Ethereum ";

    const snapshot = buildPointInTimeIntelligence(evidence);
    const ids = new Set(snapshot?.measurements.map((measurement) => measurement.id));

    expect(ids.has("tvl_usd")).toBe(true);
    expect(ids.has("protocol_fees_30d_usd")).toBe(true);
    expect(ids.has("holder_count")).toBe(true);
    expect(ids.has("next_unlock_usd")).toBe(true);
    expect(ids.has("evm_control_target_state")).toBe(true);
    expect(snapshot?.signals.find((signal) => signal.id.endsWith("identity_mismatch"))).toBeUndefined();
  });

  it("withholds directional volume-change claims when either subwindow or the candle span is incomplete", () => {
    for (const incomplete of ["volume", "span"] as const) {
      const evidence = projectEvidence();
      addCanonicalToken(evidence);
      evidence.projectToken!.history = {
        points: [10, 8],
        first: 10,
        last: 8,
        peak: 10,
        changePct: -20,
        drawdownPct: -20,
        spanPeriods: 4,
        windowIsPartial: incomplete === "span",
        volume: {
          recent: { usd: 200, candles: 2, measured: 2 },
          prior: { usd: 100, candles: 2, measured: incomplete === "volume" ? 1 : 2 },
          changePct: 100,
          isFloor: incomplete === "volume",
        },
        timeframe: "day",
        poolAddress: "0xpool",
      };

      const snapshot = buildPointInTimeIntelligence(evidence);
      expect(snapshot?.measurements.find((measurement) => measurement.id === "price_window_volume_change_pct"), incomplete).toBeUndefined();
      expect(snapshot?.signals.find((signal) => signal.id === "price_volume_regime_divergence"), incomplete).toBeUndefined();
      expect(snapshot?.measurements.find((measurement) => measurement.id === "price_window_prior_volume_usd")?.label, incomplete)
        .toContain(incomplete === "volume" ? "floor" : "volume sum");
    }
  });

  it("keeps self-attested audits unverified and states a bounded provenance gap", () => {
    const evidence = projectEvidence();
    evidence.securityAudits = {
      securityPageUrl: "https://fixture.example.test/security",
      selfAttested: ["Audit One", "Audit Two"],
      attestations: [{
        auditor: "Audit One",
        origin: "subject_page",
        sourceUrl: "https://fixture.example.test/security",
      }, {
        auditor: "Audit Two",
        origin: "curated_audit_link",
        sourceUrl: "https://audits.example.test/audit-two",
      }],
      corroborated: [],
      capturedAt: "2026-08-05T12:40:00.000Z",
    };

    const snapshot = buildPointInTimeIntelligence(evidence);
    const selfAttested = snapshot?.measurements.find((measurement) => measurement.id === "audit_lead_count");
    const signal = snapshot?.signals.find((candidate) => candidate.id === "audit_provenance_gap");

    expect(selfAttested?.evidenceState).toBe("reported_context");
    expect(signal?.finding).toContain("zero auditor-domain engagements carrying a canonical subject identity anchor");
    expect(signal?.finding).toContain("not proof that no audit occurred");
    expect(snapshot?.signals.find((candidate) => candidate.id === "audit_corroboration_support")).toBeUndefined();
  });

  it("keeps a legacy audit source resolvable when unrelated structured attestations exist", () => {
    const evidence = projectEvidence();
    evidence.securityAudits = {
      securityPageUrl: "https://fixture.example.test/security",
      selfAttested: ["Audit One"],
      attestations: [{
        auditor: "Different Auditor",
        origin: "curated_audit_link",
        sourceUrl: "https://different-auditor.example.test/report",
      }],
      corroborated: [],
      capturedAt: "2026-08-05T12:40:00.000Z",
    };

    const snapshot = buildPointInTimeIntelligence(evidence)!;
    const sourceIds = new Set(snapshot.sources.map((source) => source.id));
    const auditLead = snapshot.measurements.find((measurement) => measurement.id === "audit_lead_count");
    const auditGap = snapshot.signals.find((signal) => signal.id === "audit_provenance_gap");

    expect(auditLead?.sourceRefs).toContain("audit:lead:legacy");
    expect(auditGap?.sourceRefs).toContain("audit:lead:legacy");
    expect(auditLead?.sourceRefs.every((sourceRef) => sourceIds.has(sourceRef))).toBe(true);
    expect(auditGap?.sourceRefs.every((sourceRef) => sourceIds.has(sourceRef))).toBe(true);
  });

  it("keeps two legacy auditor-domain rows as leads and withholds subject-level support", () => {
    const evidence = projectEvidence();
    addCanonicalToken(evidence);
    addObservedEvmControl(evidence);
    evidence.securityAudits = {
      securityPageUrl: null,
      selfAttested: [],
      attestations: [],
      corroborated: [{
        auditor: "Alpha Audit",
        auditorUrl: "https://alpha-audit.example.test/fixture",
        excerpt: "Alpha Audit published a legacy engagement page naming the fixture.",
      }, {
        auditor: "Beta Audit",
        auditorUrl: "https://beta-audit.example.test/fixture",
        excerpt: "Beta Audit published a legacy engagement page naming the fixture.",
      }],
      capturedAt: "2026-08-05T12:40:00.000Z",
    };

    const snapshot = buildPointInTimeIntelligence(evidence);
    const measurement = (id: string) => snapshot?.measurements.find((candidate) => candidate.id === id);
    const legacySources = snapshot?.sources.filter((source) => source.id.startsWith("audit:corroborated:"));
    const anchorGap = snapshot?.signals.find((signal) => signal.id === "audit_identity_anchor_gap");

    expect(measurement("audit_lead_count")?.value).toBe(2);
    expect(measurement("corroborated_audit_count")?.value).toBe(0);
    expect(measurement("audit_identity_anchor_gap_count")?.value).toBe(2);
    expect(legacySources).toHaveLength(2);
    expect(legacySources?.every((source) => source.evidenceState === "reported_context")).toBe(true);
    expect(legacySources?.every((source) => source.title.startsWith("Legacy auditor-domain audit lead:"))).toBe(true);
    expect(anchorGap).toMatchObject({ kind: "coverage_gap", polarity: "unknown", evidenceState: "reported_context" });
    expect(anchorGap?.finding).toContain("do not count as subject-level corroboration");
    expect(anchorGap?.sourceRefs).toEqual([
      "audit:corroborated:01",
      "audit:corroborated:02",
      "snapshot:security-audits",
    ]);
    expect(snapshot?.signals.find((signal) => signal.id === "audit_corroboration_support")).toBeUndefined();
    expect(snapshot?.signals.find((signal) => signal.id === "audit_to_deployment_scope_gap")).toBeUndefined();
  });

  it("counts only identity-anchored rows when legacy audit leads coexist with support", () => {
    const evidence = projectEvidence();
    evidence.profile.website = "https://fixture.org";
    addCanonicalToken(evidence);
    evidence.securityAudits = {
      securityPageUrl: "https://fixture.example.test/security",
      selfAttested: ["Alpha Legacy", "Beta Legacy", "Delta Anchored", "Gamma Anchored"],
      attestations: [],
      corroborated: [{
        auditor: "Alpha Legacy",
        auditorUrl: "https://alpha.example.test/fixture",
        excerpt: "Alpha published a legacy engagement page.",
      }, {
        auditor: "Beta Legacy",
        auditorUrl: "https://beta.example.test/fixture",
        excerpt: "Beta published a legacy engagement page.",
      }, {
        auditor: "Delta Anchored",
        auditorUrl: "https://delta.example.test/fixture",
        excerpt: "Delta published an identity-bound engagement page.",
        matchedIdentityAnchor: { type: "official_domain", value: "HTTPS://WWW.FIXTURE.ORG/audits" },
      }, {
        auditor: "Gamma Anchored",
        auditorUrl: "https://gamma.example.test/fixture",
        excerpt: "Gamma published an identity-bound engagement page.",
        matchedIdentityAnchor: { type: "canonical_contract", value: evidence.projectToken!.address },
      }],
      capturedAt: "2026-08-05T12:40:00.000Z",
    };

    const snapshot = buildPointInTimeIntelligence(evidence);
    const measurement = (id: string) => snapshot?.measurements.find((candidate) => candidate.id === id);
    const support = snapshot?.signals.find((signal) => signal.id === "audit_corroboration_support");

    expect(measurement("audit_lead_count")?.value).toBe(2);
    expect(measurement("corroborated_audit_count")?.value).toBe(2);
    expect(measurement("audit_identity_anchor_gap_count")?.value).toBe(2);
    expect(support?.finding).toContain("2 engagements");
    expect(support?.sourceRefs).toEqual([
      "audit:corroborated:03",
      "audit:corroborated:04",
      "snapshot:security-audits",
    ]);
  });

  it("rejects lookalike, credential-bearing, and noncanonical official-domain anchor values", () => {
    const evidence = projectEvidence();
    evidence.profile.website = "https://profile-site.org";
    addCanonicalToken(evidence);
    evidence.projectToken!.homepage = "https://canonical-site.org/docs";
    addObservedEvmControl(evidence);
    evidence.securityAudits = {
      securityPageUrl: null,
      selfAttested: ["Credential Audit", "Profile Domain Audit", "Suffix Audit"],
      attestations: [],
      corroborated: [{
        auditor: "Credential Audit",
        auditorUrl: "https://credential-audit.example.test/fixture",
        excerpt: "Credential Audit published an engagement page.",
        matchedIdentityAnchor: { type: "official_domain", value: "https://canonical-site.org@attacker.org" },
      }, {
        auditor: "Profile Domain Audit",
        auditorUrl: "https://profile-domain-audit.example.test/fixture",
        excerpt: "Profile Domain Audit published an engagement page.",
        matchedIdentityAnchor: { type: "official_domain", value: "profile-site.org" },
      }, {
        auditor: "Suffix Audit",
        auditorUrl: "https://suffix-audit.example.test/fixture",
        excerpt: "Suffix Audit published an engagement page.",
        matchedIdentityAnchor: { type: "official_domain", value: "canonical-site.org.attacker.org" },
      }],
      capturedAt: "2026-08-05T12:40:00.000Z",
    };

    const snapshot = buildPointInTimeIntelligence(evidence);
    const measurement = (id: string) => snapshot?.measurements.find((candidate) => candidate.id === id);
    const auditSources = snapshot?.sources.filter((source) => source.id.startsWith("audit:corroborated:"));
    const anchorGap = snapshot?.signals.find((signal) => signal.id === "audit_identity_anchor_gap");

    expect(measurement("audit_lead_count")?.value).toBe(3);
    expect(measurement("corroborated_audit_count")?.value).toBe(0);
    expect(measurement("corroborated_audit_count")?.sourceRefs).toEqual(["snapshot:security-audits"]);
    expect(measurement("audit_identity_anchor_gap_count")?.value).toBe(3);
    expect(measurement("audit_identity_anchor_mismatch_count")?.value).toBe(3);
    expect(auditSources?.every((source) => source.evidenceState === "reported_context")).toBe(true);
    expect(auditSources?.every((source) => source.title.startsWith("Identity-mismatched auditor-domain audit lead:"))).toBe(true);
    expect(anchorGap).toMatchObject({ kind: "coverage_gap", severity: "high", polarity: "unknown" });
    expect(anchorGap?.finding).toContain("fails the exact canonical token-address or official-site-host match");
    expect(snapshot?.signals.find((signal) => signal.id === "audit_corroboration_support")).toBeUndefined();
    expect(snapshot?.signals.find((signal) => signal.id === "audit_to_deployment_scope_gap")).toBeUndefined();
  });

  it("requires a verified canonical token and exact normalized address equality for contract anchors", () => {
    const canonicalAddress = "0x00000000000000000000000000000000000000aa";
    const mismatchAddress = "0x00000000000000000000000000000000000000bb";
    const cases: Array<{
      label: string;
      configure: (evidence: CollectedEvidence) => void;
      anchor: string;
    }> = [{
      label: "canonical token absent",
      configure: () => undefined,
      anchor: canonicalAddress,
    }, {
      label: "canonical token unverified",
      configure: (evidence) => {
        addCanonicalToken(evidence);
        (evidence.projectToken as unknown as { verified: boolean }).verified = false;
        evidence.projectToken!.address = canonicalAddress;
      },
      anchor: canonicalAddress,
    }, {
      label: "verified canonical token address differs",
      configure: (evidence) => {
        addCanonicalToken(evidence);
        evidence.projectToken!.address = canonicalAddress;
      },
      anchor: mismatchAddress,
    }];

    for (const testCase of cases) {
      const evidence = projectEvidence();
      addObservedEvmControl(evidence);
      testCase.configure(evidence);
      evidence.securityAudits = {
        securityPageUrl: null,
        selfAttested: ["Audit Firm"],
        attestations: [],
        corroborated: [{
          auditor: "Audit Firm",
          auditorUrl: "https://auditor.example.test/fixture",
          excerpt: "Audit Firm published a contract-specific security review.",
          matchedIdentityAnchor: { type: "canonical_contract", value: testCase.anchor },
        }],
        capturedAt: "2026-08-05T12:40:00.000Z",
      };

      const snapshot = buildPointInTimeIntelligence(evidence);
      const measurement = (id: string) => snapshot?.measurements.find((candidate) => candidate.id === id);
      expect(measurement("corroborated_audit_count")?.value, testCase.label).toBe(0);
      expect(measurement("audit_lead_count")?.value, testCase.label).toBe(1);
      expect(measurement("audit_identity_anchor_mismatch_count")?.value, testCase.label).toBe(1);
      expect(snapshot?.signals.find((signal) => signal.id === "audit_identity_anchor_gap")?.severity, testCase.label).toBe("high");
      expect(snapshot?.signals.find((signal) => signal.id === "audit_to_deployment_scope_gap"), testCase.label).toBeUndefined();
    }

    const matchedEvidence = projectEvidence();
    addObservedEvmControl(matchedEvidence);
    addCanonicalToken(matchedEvidence);
    matchedEvidence.projectToken!.address = canonicalAddress;
    matchedEvidence.securityAudits = {
      securityPageUrl: null,
      selfAttested: ["Audit Firm"],
      attestations: [],
      corroborated: [{
        auditor: "Audit Firm",
        auditorUrl: "https://auditor.example.test/fixture",
        excerpt: "Audit Firm published a contract-specific security review.",
        matchedIdentityAnchor: { type: "canonical_contract", value: canonicalAddress.toUpperCase() },
      }],
      capturedAt: "2026-08-05T12:40:00.000Z",
    };

    const matchedSnapshot = buildPointInTimeIntelligence(matchedEvidence);
    expect(matchedSnapshot?.measurements.find((measurement) => measurement.id === "corroborated_audit_count")?.value).toBe(1);
    expect(matchedSnapshot?.measurements.find((measurement) => measurement.id === "audit_identity_anchor_gap_count")).toBeUndefined();
    expect(matchedSnapshot?.sources.find((source) => source.id === "audit:corroborated:01")?.evidenceState).toBe("bounded");
    expect(matchedSnapshot?.signals.find((signal) => signal.id === "audit_to_deployment_scope_gap")).toBeDefined();
  });

  it("never borrows an unrelated fact passage or hash for an audit sharing the same URL", () => {
    const evidence = projectEvidence();
    addCanonicalToken(evidence);
    evidence.projectToken!.address = "0xabc";
    const product = strictFact("Acme builds analytics dashboards", { factId: "shared-url-product" });
    product.sources[0] = {
      ...product.sources[0],
      url: "https://auditor.example.test/acme",
      excerpt: "Acme builds analytics dashboards.",
      contentHash: "product-hash",
    };
    evidence.basicFacts = [product];
    evidence.securityAudits = {
      securityPageUrl: null,
      selfAttested: ["Audit Firm"],
      attestations: [],
      corroborated: [{
        auditor: "Audit Firm",
        auditorUrl: "https://auditor.example.test/acme",
        excerpt: "Audit Firm completed a security audit of the Acme protocol contracts.",
        matchedIdentityAnchor: { type: "canonical_contract", value: "0xabc" },
      }],
      capturedAt: "2026-08-05T12:40:00.000Z",
    };

    const source = buildPointInTimeIntelligence(evidence)?.sources
      .find((candidate) => candidate.id === "audit:corroborated:01");

    expect(source?.excerpt).toContain("completed a security audit");
    expect(source?.excerpt).not.toContain("analytics dashboards");
    expect(source?.contentHashes).toBeUndefined();
  });

  it("produces deterministic multi-source unlock arithmetic with both source refs", () => {
    const evidence = projectEvidence();
    addCanonicalToken(evidence);
    evidence.projectToken!.liquidityUsd = 2_000_000;
    evidence.projectToken!.volume24hUsd = 4_000_000;
    evidence.tokenUnlocks = {
      nextUnlockDate: "2026-09-01T00:00:00.000Z",
      allocationName: "Team",
      percentOfSupply: 2,
      unlockValueUsd: 1_000_000,
      percentOfMcap: 5,
      cumulativeUnlockedPercent: 40,
      next90dPercentOfSupply: 6,
      canonicalAddress: evidence.projectToken!.address,
      chain: evidence.projectToken!.chain,
      currencyId: 42,
      contractSourceUrl: "https://api.cryptorank.example.test/currencies/contracts",
      eventsSourceUrl: "https://api.cryptorank.example.test/currencies/42/vesting",
      sourceUrl: "https://cryptorank.example.test/fix/vesting",
      capturedAt: "2026-08-05T12:50:00.000Z",
    };

    const signal = buildPointInTimeIntelligence(evidence)?.signals
      .find((candidate) => candidate.id === "unlock_absorption_surface");

    expect(signal?.sourceRefs).toEqual([
      "snapshot:project-token",
      "snapshot:token-unlock-contract-map",
      "snapshot:token-unlock-events",
      "snapshot:token-unlocks",
    ]);
    expect(signal?.arithmetic).toEqual([
      {
        expression: "next_unlock_usd / liquidity_usd * 100",
        value: 50,
        unit: "percent",
        inputMeasurementIds: ["next_unlock_usd", "liquidity_usd"],
        temporal: {
          state: "aligned",
          maxInputSkewHours: 0.6667,
          inputAsOf: [
            { measurementId: "next_unlock_usd", asOf: "2026-08-05T12:50:00.000Z" },
            { measurementId: "liquidity_usd", asOf: "2026-08-05T12:10:00.000Z" },
          ],
        },
      },
      {
        expression: "next_unlock_usd / volume_24h_usd * 100",
        value: 25,
        unit: "percent",
        inputMeasurementIds: ["next_unlock_usd", "volume_24h_usd"],
        temporal: {
          state: "aligned",
          maxInputSkewHours: 0.6667,
          inputAsOf: [
            { measurementId: "next_unlock_usd", asOf: "2026-08-05T12:50:00.000Z" },
            { measurementId: "volume_24h_usd", asOf: "2026-08-05T12:10:00.000Z" },
          ],
        },
      },
    ]);
    expect(signal?.finding).toContain("not a prediction");
  });

  it("withholds an unlock-to-liquidity comparison when the frozen inputs are more than 72 hours apart", () => {
    const evidence = projectEvidence();
    addCanonicalToken(evidence);
    evidence.projectToken!.capturedAt = "2026-08-01T00:00:00.000Z";
    evidence.projectToken!.liquidityUsd = 2_000_000;
    evidence.tokenUnlocks = {
      nextUnlockDate: "2026-09-01T00:00:00.000Z",
      allocationName: "Team",
      percentOfSupply: null,
      unlockValueUsd: 1_000_000,
      percentOfMcap: null,
      cumulativeUnlockedPercent: null,
      next90dPercentOfSupply: null,
      canonicalAddress: evidence.projectToken!.address,
      chain: evidence.projectToken!.chain,
      currencyId: 42,
      contractSourceUrl: "https://api.cryptorank.example.test/currencies/contracts",
      eventsSourceUrl: "https://api.cryptorank.example.test/currencies/42/vesting",
      sourceUrl: "https://cryptorank.example.test/fix/vesting",
      capturedAt: "2026-08-05T12:50:00.000Z",
    };

    const snapshot = buildPointInTimeIntelligence(evidence);
    const gap = snapshot?.signals.find((signal) => signal.id === "temporal_alignment_gap:unlock_to_liquidity");

    expect(snapshot?.signals.find((signal) => signal.id === "unlock_absorption_surface")).toBeUndefined();
    expect(gap).toMatchObject({
      kind: "coverage_gap",
      domain: "chronology",
      evidenceState: "bounded",
      measurementRefs: ["liquidity_usd", "next_unlock_usd"],
      sourceRefs: [
        "snapshot:project-token",
        "snapshot:token-unlock-contract-map",
        "snapshot:token-unlock-events",
        "snapshot:token-unlocks",
      ],
    });
    expect(gap?.finding).toContain("108.8333 hours");
    expect(gap?.finding).toContain("next_unlock_usd=2026-08-05T12:50:00.000Z");
    expect(gap?.finding).toContain("liquidity_usd=2026-08-01T00:00:00.000Z");
  });

  it("withholds a same-source market ratio when its capture time is invalid", () => {
    const evidence = projectEvidence();
    addCanonicalToken(evidence);
    evidence.projectToken!.capturedAt = "invalid-capture-time";
    evidence.projectToken!.marketCapUsd = 25_000_000;
    evidence.projectToken!.fdvUsd = 75_000_000;
    evidence.projectToken!.circulatingSupply = 25;
    evidence.projectToken!.totalSupply = 100;

    const snapshot = buildPointInTimeIntelligence(evidence);
    const gap = snapshot?.signals.find((signal) => signal.id === "temporal_alignment_gap:fdv_to_market_cap");

    expect(snapshot?.signals.find((signal) => signal.id === "reported_supply_overhang")).toBeUndefined();
    expect(gap).toMatchObject({
      kind: "coverage_gap",
      measurementRefs: ["circulating_supply_pct", "fdv_usd", "market_cap_usd"],
      sourceRefs: ["snapshot:project-token"],
    });
    expect(gap?.finding).toContain("lacks a valid frozen as-of");
    expect(gap?.finding).toContain("fdv_usd=invalid-capture-time");
  });

  it("withholds holder concentration against a newer market snapshot", () => {
    const evidence = projectEvidence();
    addCanonicalToken(evidence);
    evidence.projectToken!.marketCapUsd = 100_000_000;
    evidence.projectToken!.liquidityUsd = 5_000_000;
    evidence.holderProfile = {
      binding: { canonicalAddress: evidence.projectToken!.address, chain: evidence.projectToken!.chain, method: "canonical_token_address_chain" },
      topHolderPct: 30,
      top10Pct: 60,
      assessedWalletCount: 10,
      top10PctIsFloor: false,
      holderCount: 12_000,
      lpLockedOrBurnedPct: null,
      holdersAssessed: true,
      distributionSource: "goplus",
      contractFlags: [],
      creatorPct: null,
      sourceUrl: "https://goplus.example.test/token",
      sourceCapturedAt: "2026-08-01T00:00:00.000Z",
      capturedAt: "2026-08-01T00:00:00.000Z",
    };

    const snapshot = buildPointInTimeIntelligence(evidence);
    const gap = snapshot?.signals.find((signal) => signal.id === "temporal_alignment_gap:holder_concentration_to_liquidity_market_cap");

    expect(snapshot?.signals.find((signal) => signal.id === "concentrated_exit_surface")).toBeUndefined();
    expect(gap).toMatchObject({
      measurementRefs: ["liquidity_usd", "market_cap_usd", "top_10_holder_pct"],
      sourceRefs: ["snapshot:holder-profile", "snapshot:project-token"],
    });
    expect(gap?.finding).toContain("108.1667 hours");
  });

  it("withholds stale fee-to-TVL, fee-trend, and fee-to-funding comparisons independently", () => {
    const evidence = projectEvidence();
    addCanonicalToken(evidence);
    addProtocolTvl(evidence);
    evidence.protocolTvl!.capturedAt = "2026-08-01T00:00:00.000Z";
    evidence.protocolFunding = {
      slug: "fixture",
      name: "Fixture",
      geckoId: "fixture",
      rounds: [{ date: "2025-01-01", round: "Seed", amountUsd: 10_000_000, leadInvestors: ["Lead Fund"], otherInvestors: [], valuationUsd: 50_000_000 }],
      totalRaisedUsd: 10_000_000,
      leadInvestors: ["Lead Fund"],
      sourceUrl: "https://defillama.example.test/raises/fixture",
      capturedAt: "2026-08-01T00:00:00.000Z",
    };
    evidence.protocolFees = {
      slug: "fixture",
      binding: { canonicalGeckoId: "fixture", protocolSlug: "fixture", method: "matched_protocol_gecko_id" },
      total24hUsd: 30_000,
      total30dUsd: 1_000_000,
      change30dOver30dPct: 30,
      sourceUrl: "https://defillama.example.test/fees/fixture",
      capturedAt: "2026-08-05T12:31:00.000Z",
    };

    const snapshot = buildPointInTimeIntelligence(evidence);
    const byId = new Map(snapshot?.signals.map((signal) => [signal.id, signal]));

    expect(byId.has("usage_capital_divergence")).toBe(false);
    expect(byId.has("protocol_fee_intensity")).toBe(false);
    expect(byId.has("disclosed_capital_to_fee_scale")).toBe(false);
    expect(byId.get("temporal_alignment_gap:tvl_fee_trend_divergence")).toMatchObject({
      measurementRefs: ["protocol_fees_change_30d_pct", "tvl_change_30d_pct"],
      sourceRefs: ["snapshot:protocol-fees", "snapshot:protocol-tvl"],
    });
    expect(byId.get("temporal_alignment_gap:protocol_fee_intensity")).toMatchObject({
      measurementRefs: ["protocol_fees_30d_usd", "tvl_usd"],
      sourceRefs: ["snapshot:protocol-fees", "snapshot:protocol-tvl"],
    });
    expect(byId.get("temporal_alignment_gap:fees_to_disclosed_funding")).toMatchObject({
      measurementRefs: ["indexed_disclosed_round_sum_usd", "protocol_fees_30d_usd"],
      sourceRefs: ["snapshot:protocol-fees", "snapshot:protocol-funding"],
    });
  });

  it("labels historical incident amount against current TVL as a historical-to-current scale", () => {
    const evidence = projectEvidence();
    addCanonicalToken(evidence);
    addProtocolTvl(evidence);
    evidence.protocolTvl!.hacks = [{
      date: "2025-01-01",
      amountUsd: 5_000_000,
      returnedFunds: false,
      classification: "exploit",
    }];

    const snapshot = buildPointInTimeIntelligence(evidence);
    const signal = snapshot?.signals.find((candidate) => candidate.id === "recorded_incident_scale");

    expect(signal).toMatchObject({ kind: "arithmetic", measurementRefs: ["largest_recorded_incident_usd", "tvl_usd"] });
    expect(signal?.arithmetic).toEqual([{
      expression: "largest_recorded_incident_usd / tvl_usd * 100",
      value: 25,
      unit: "percent",
      inputMeasurementIds: ["largest_recorded_incident_usd", "tvl_usd"],
      temporal: {
        state: "historical_amount_to_current_scale",
        maxInputSkewHours: 0,
        inputAsOf: [
          { measurementId: "largest_recorded_incident_usd", asOf: "2026-08-05T12:20:00.000Z" },
          { measurementId: "tvl_usd", asOf: "2026-08-05T12:20:00.000Z" },
        ],
      },
    }]);
    expect(signal?.finding).toContain("equal to 25% of reported TVL in this capture");
  });

  it("preserves answered, partial, unavailable, unresolved, and not-collected question states", () => {
    const evidence = projectEvidence();
    const productFact = strictFact("A decentralized exchange", { factId: "product-answer", questionId: "project.product" });
    evidence.basicFacts = [productFact];
    evidence.basicFactQuestionLedger = [
      {
        questionId: "project.product",
        audience: "project",
        batch: "identity",
        predicate: "product",
        question: "What is the product?",
        critical: true,
        status: "answered",
        answerRefs: [productFact.factId],
        providerRuns: [{ phase: "primary", provider: "test", state: "succeeded" }],
      },
      {
        questionId: "project.control",
        audience: "project",
        batch: "structure_risk",
        predicate: "control",
        question: "Who controls upgrades?",
        critical: true,
        status: "unanswered",
        answerRefs: [],
        providerRuns: [{ phase: "primary", provider: "test", state: "partial" }],
      },
      {
        questionId: "project.audit",
        audience: "project",
        batch: "structure_risk",
        predicate: "audit",
        question: "What audits exist?",
        critical: false,
        status: "unanswered",
        answerRefs: [],
        providerRuns: [{ phase: "primary", provider: "test", state: "failed" }],
      },
      {
        questionId: "project.treasury",
        audience: "project",
        batch: "structure_risk",
        predicate: "treasury",
        question: "What treasury exists?",
        critical: true,
        status: "unanswered",
        answerRefs: [],
        providerRuns: [{ phase: "primary", provider: "test", state: "completed_empty" }],
      },
      {
        questionId: "project.governance",
        audience: "project",
        batch: "structure_risk",
        predicate: "governance",
        question: "How is governance executed?",
        critical: false,
        status: "unanswered",
        answerRefs: [],
        providerRuns: [{ phase: "primary", provider: "none", state: "skipped" }],
      },
    ];

    const states = Object.fromEntries(
      (buildPointInTimeIntelligence(evidence)?.questions ?? []).map((question) => [question.id, question.state]),
    );

    expect(states).toMatchObject({
      "project.product": "partial",
      "project.control": "partial",
      "project.audit": "unavailable",
      "project.treasury": "unresolved",
      "project.governance": "not_collected",
    });
  });

  it("treats a failed attempted pass plus a skipped repair as unavailable", () => {
    const evidence = projectEvidence();
    evidence.basicFactQuestionLedger = [{
      questionId: "project.audit",
      audience: "project",
      batch: "structure_risk",
      predicate: "audit",
      question: "Which audits exist?",
      critical: true,
      status: "unanswered",
      answerRefs: [],
      providerRuns: [{ phase: "primary", provider: "grounded", state: "failed" }, {
        phase: "repair",
        provider: "none",
        state: "skipped",
      }],
    }];

    const question = buildPointInTimeIntelligence(evidence)?.questions
      .find((candidate) => candidate.id === "project.audit");

    expect(question).toMatchObject({ state: "unavailable" });
    expect(question?.basis).toContain("failed");
    expect(question?.basis).toContain("no negative claim");
  });

  it("retains canonical fact-prefixed question answer references", () => {
    const evidence = projectEvidence();
    const product = strictFact("A lending protocol", {
      factId: "prefixed-product-answer",
      questionId: "project.product",
    });
    evidence.basicFacts = [product];
    evidence.basicFactQuestionLedger = [{
      questionId: "project.product",
      audience: "project",
      batch: "identity",
      predicate: "product",
      question: "What is the product?",
      critical: true,
      status: "answered",
      answerRefs: [`fact:${product.factId}`],
      providerRuns: [{ phase: "primary", provider: "test", state: "succeeded" }],
    }];

    const snapshot = buildPointInTimeIntelligence(evidence)!;
    const question = snapshot.questions.find((candidate) => candidate.id === "project.product");

    expect(question?.answerRefs).toEqual([`fact:${product.factId}`]);
    expect(snapshot.signals.find((signal) => signal.id === "intelligence_integrity_gap")).toBeUndefined();
  });

  it("never upgrades an unavailable question when only part of its lineage survives", () => {
    const evidence = projectEvidence();
    addCanonicalToken(evidence);
    evidence.projectToken!.marketCapUsd = 25_000_000;
    evidence.basicFactQuestionLedger = [{
      questionId: "project.custom_unavailable",
      audience: "project",
      batch: "structure_risk",
      predicate: "audit",
      question: "What exact scope was reviewed?",
      critical: true,
      status: "unanswered",
      answerRefs: ["market_cap_usd", "missing-answer"],
      providerRuns: [{ phase: "primary", provider: "test", state: "failed" }],
    }];

    const snapshot = buildPointInTimeIntelligence(evidence)!;
    const question = snapshot.questions.find((candidate) => candidate.id === "project.custom_unavailable");

    expect(question).toMatchObject({ state: "unavailable", answerRefs: ["market_cap_usd"] });
    expect(snapshot.signals.find((signal) => signal.id === "intelligence_integrity_gap")).toBeDefined();
  });

  it("merges exact EVM measurements into an existing control ledger entry without resolving the full question", () => {
    const evidence = projectEvidence();
    addCanonicalToken(evidence);
    addObservedEvmControl(evidence);
    evidence.basicFactQuestionLedger = [{
      questionId: "project.control",
      audience: "project",
      batch: "structure_risk",
      predicate: "control",
      question: "Who controls upgrades and emergency actions?",
      critical: true,
      status: "unanswered",
      answerRefs: [],
      providerRuns: [{ phase: "primary", provider: "grounded", state: "failed" }],
    }];

    const snapshot = buildPointInTimeIntelligence(evidence);
    const question = snapshot?.questions.find((candidate) => candidate.id === "project.control");

    expect(question?.state).toBe("partial");
    expect(question?.answerRefs).toEqual(expect.arrayContaining([
      "evm_control_target_state",
      "evm_standard_proxy_state",
      "evm_standard_authority_count",
    ]));
    expect(question?.sourceRefs).toEqual(["snapshot:evm-control-reality"]);
    expect(question?.basis).toContain("do not establish facet-level completeness");
    expect(snapshot?.measurements.find((measurement) => measurement.id === "evm_rpc_observed_chain_id"))
      .toMatchObject({ value: "0x1", sourceRefs: ["snapshot:evm-control-reality"] });
    expect(snapshot?.sources.find((source) => source.id === "snapshot:evm-control-reality")?.excerpt)
      .toContain("verified 0x1 for ethereum");
  });

  it("keeps multi-facet founder and treasury answers partial and maps public securities to market", () => {
    const evidence = projectEvidence();
    const founder = strictFact("Alice founded the project", { factId: "founder", predicate: "founder", questionId: "project.founder" });
    const treasury = strictFact("Treasury wallet 0xabc holds disclosed assets", { factId: "treasury", predicate: "treasury", questionId: "project.treasury" });
    const publicSecurity = strictFact("ACME common stock trades on NASDAQ", { factId: "equity", predicate: "public_security", questionId: "project.public_security" });
    evidence.basicFacts = [founder, treasury, publicSecurity];
    evidence.basicFactQuestionLedger = [
      { questionId: "project.founder", audience: "project", batch: "identity", predicate: "founder", question: "Who founded the project?", critical: true, status: "answered", answerRefs: [founder.factId], providerRuns: [{ phase: "primary", provider: "test", state: "succeeded" }] },
      { questionId: "project.treasury", audience: "project", batch: "structure_risk", predicate: "treasury", question: "What assets, liabilities, and spending controls exist?", critical: true, status: "answered", answerRefs: [treasury.factId], providerRuns: [{ phase: "primary", provider: "test", state: "succeeded" }] },
      { questionId: "project.public_security", audience: "project", batch: "track_record", predicate: "public_security", question: "Is a public security outstanding?", critical: false, status: "answered", answerRefs: [publicSecurity.factId], providerRuns: [{ phase: "primary", provider: "test", state: "succeeded" }] },
    ];

    const questions = buildPointInTimeIntelligence(evidence)?.questions ?? [];

    expect(questions.find((question) => question.id === "project.founder")).toMatchObject({ state: "partial" });
    expect(questions.find((question) => question.id === "project.treasury")).toMatchObject({ state: "partial" });
    expect(questions.find((question) => question.id === "project.public_security")).toMatchObject({ domain: "market", state: "partial" });
  });

  it("suppresses zero funding totals and ignores name-only company enrichment", () => {
    const evidence = projectEvidence();
    addCanonicalToken(evidence);
    evidence.protocolFunding = {
      slug: "fixture",
      name: "Fixture",
      geckoId: "fixture",
      rounds: [],
      totalRaisedUsd: 0,
      leadInvestors: [],
      sourceUrl: "https://defillama.example.test/raises/fixture",
      capturedAt: "2026-08-05T12:30:00.000Z",
    };
    evidence.companyEnrichment = {
      name: "Namesake Fixture",
      uuid: "namesake",
      identityMatch: "name_only",
      matchMethod: "exact_name",
      funding: {
        totalRaisedUsd: 500_000_000,
        rounds: [{ date: "2025-01-01", round: "Series C", amountUsd: 500_000_000, leadInvestors: ["Namesake Fund"], otherInvestors: [] }],
        leadInvestors: ["Namesake Fund"],
      },
      sourceUrl: "https://licensed.example.test/namesake",
      capturedAt: "2026-08-05T12:31:00.000Z",
    };

    const snapshot = buildPointInTimeIntelligence(evidence);

    expect(snapshot?.measurements.find((measurement) => measurement.id === "funding_round_count"))
      .toMatchObject({ value: 0, sourceRefs: ["snapshot:protocol-funding"] });
    expect(snapshot?.measurements.find((measurement) => measurement.id === "total_raised_usd")).toBeUndefined();
    expect(snapshot?.sources.find((source) => source.id === "snapshot:company-enrichment"))
      .toMatchObject({ title: "Unbound company-enrichment receipt", evidenceState: "bounded" });
    expect(snapshot?.signals.find((signal) => signal.id === "company_enrichment_identity_unbound"))
      .toMatchObject({ severity: "high", polarity: "unknown" });
    expect(JSON.stringify(snapshot)).not.toContain("Namesake Fund");
  });

  it("withholds a licensed company row whose claimed official-domain match fails exact host revalidation", () => {
    const evidence = projectEvidence();
    evidence.profile.website = "https://subject.example";
    evidence.companyEnrichment = {
      name: "Wrong Corp",
      uuid: "wrong-company",
      identityMatch: "official_domain",
      requestedDomain: "subject.example",
      matchedDomain: "evil.example",
      matchMethod: "exact_host",
      funding: {
        totalRaisedUsd: 900_000_000,
        rounds: [{ date: "2026-01-01", round: "Series Z", amountUsd: 900_000_000, leadInvestors: ["Fake Fund"], otherInvestors: [] }],
        leadInvestors: ["Fake Fund"],
      },
      management: [{ name: "Wrong Executive", title: "CEO", priorCompanies: [], linkedin: null, startYear: "2025" }],
      firmographic: { legalName: "Wrong Corp LLC", foundedYear: "2025", headcountRange: "500+", ownership: "private" },
      sourceUrl: "https://evil.example/company",
      capturedAt: CAPTURED_AT,
    };

    const snapshot = buildPointInTimeIntelligence(evidence);
    const companyMeasurements = snapshot?.measurements.filter((measurement) =>
      measurement.sourceRefs.includes("snapshot:company-enrichment")) ?? [];

    expect(snapshot?.subject.forms.some((form) => form.form === "company")).toBe(false);
    expect(companyMeasurements).toEqual([]);
    expect(snapshot?.signals.find((signal) => signal.id === "company_enrichment_identity_unbound"))
      .toMatchObject({ severity: "high", sourceRefs: ["snapshot:company-enrichment"] });
    expect(snapshot?.sources.find((source) => source.id === "snapshot:company-enrichment"))
      .toMatchObject({ title: "Unbound company-enrichment receipt", sourceUrl: "https://evil.example/company" });
    expect(JSON.stringify(snapshot)).not.toContain("Fake Fund");
    expect(JSON.stringify(snapshot)).not.toContain("Wrong Executive");
  });

  it("admits company fields only when the complete licensed receipt rebinds to the canonical official host", () => {
    const evidence = projectEvidence();
    evidence.profile.website = "https://app.subject.example";
    evidence.companyEnrichment = {
      name: "Subject Corp",
      uuid: "subject-company",
      identityMatch: "official_domain",
      requestedDomain: "app.subject.example",
      matchedDomain: "subject.example",
      matchMethod: "parent_or_subdomain",
      funding: {
        totalRaisedUsd: 12_000_000,
        rounds: [{ date: "2025-01-01", round: "Seed", amountUsd: 12_000_000, leadInvestors: ["Real Fund"], otherInvestors: [] }],
        leadInvestors: ["Real Fund"],
      },
      sourceUrl: "https://subject.example/company",
      capturedAt: CAPTURED_AT,
    };

    const snapshot = buildPointInTimeIntelligence(evidence);

    expect(snapshot?.subject.forms).toEqual(expect.arrayContaining([
      expect.objectContaining({ form: "company", sourceRefs: ["snapshot:company-enrichment"] }),
    ]));
    expect(snapshot?.measurements.find((measurement) => measurement.id === "provider_reported_total_funding_usd"))
      .toMatchObject({ value: 12_000_000, sourceRefs: ["snapshot:company-enrichment"] });
    expect(snapshot?.questions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "company.registry_status", state: "not_collected" }),
      expect.objectContaining({ id: "company.operating_reality" }),
      expect.objectContaining({ id: "company.ownership_control" }),
    ]));
    expect(snapshot?.signals.find((signal) => signal.id === "company_enrichment_identity_unbound")).toBeUndefined();
  });

  it("withholds a wrong-domain RDAP row and every saved launch comparison derived from it", () => {
    const evidence = projectEvidence();
    evidence.profile.website = "https://subject.example";
    evidence.profile.profile_collection_state = "resolved";
    evidence.profile.profile_provider = "twitterapi";
    evidence.profile.profile_captured_at = "2026-08-05T12:00:00.000Z";
    evidence.profile.account_created_at = "2025-01-01T00:00:00.000Z";
    evidence.domainRegistration = {
      domain: "google.com",
      hostname: "google.com",
      registeredAt: "1997-09-15T00:00:00.000Z",
      ageMonths: 347,
      source: "https://rdap.org/domain/google.com",
      capturedAt: "2026-08-05T12:01:00.000Z",
    };
    evidence.launchWindow = {
      earliest: "1997-09-15T00:00:00.000Z",
      earliestSource: "domain",
      latest: "2025-01-01T00:00:00.000Z",
      latestSource: "account",
      gapMonths: 328,
      summary: "A wrong-domain comparison that must not survive.",
    };

    const snapshot = buildPointInTimeIntelligence(evidence);

    expect(snapshot?.measurements.find((measurement) => measurement.id === "domain_age_months")).toBeUndefined();
    expect(snapshot?.measurements.some((measurement) => measurement.id.startsWith("launch_window_"))).toBe(false);
    expect(snapshot?.signals.find((signal) => signal.id === "domain_registration_identity_unbound"))
      .toMatchObject({ severity: "high", polarity: "unknown" });
    expect(snapshot?.signals.find((signal) => signal.id === "launch_window_inputs_unbound"))
      .toBeDefined();
    expect(snapshot?.sources.find((source) => source.id === "snapshot:domain-registration"))
      .toMatchObject({ title: "Unbound domain-registration receipt" });
  });

  it("recomputes domain age and the public-footprint window from exact bound receipts", () => {
    const evidence = projectEvidence();
    evidence.profile.website = "https://app.subject.example";
    evidence.profile.profile_collection_state = "resolved";
    evidence.profile.profile_provider = "twitterapi";
    evidence.profile.profile_captured_at = "2026-08-05T12:00:00.000Z";
    evidence.profile.account_created_at = "2021-01-01T00:00:00.000Z";
    evidence.domainRegistration = {
      domain: "subject.example",
      hostname: "app.subject.example",
      registeredAt: "2020-01-01T00:00:00.000Z",
      ageMonths: 999,
      source: "https://rdap.org/domain/subject.example",
      capturedAt: "2026-08-05T12:01:00.000Z",
    };
    evidence.launchWindow = {
      earliest: "1900-01-01T00:00:00.000Z",
      earliestSource: "account",
      latest: "2099-01-01T00:00:00.000Z",
      latestSource: "domain",
      gapMonths: 2_388,
      summary: "Attacker-selected saved values that must be ignored.",
    };

    const snapshot = buildPointInTimeIntelligence(evidence);

    expect(snapshot?.measurements.find((measurement) => measurement.id === "domain_age_months"))
      .toMatchObject({ value: 79, sourceRefs: ["snapshot:domain-registration"] });
    expect(snapshot?.measurements.find((measurement) => measurement.id === "official_domain_registered_at"))
      .toMatchObject({ value: "2020-01-01T00:00:00.000Z", sourceRefs: ["snapshot:domain-registration"] });
    expect(snapshot?.measurements.find((measurement) => measurement.id === "launch_window_earliest_date"))
      .toMatchObject({ value: "2020-01-01T00:00:00.000Z" });
    expect(snapshot?.measurements.find((measurement) => measurement.id === "launch_window_latest_date"))
      .toMatchObject({ value: "2021-01-01T00:00:00.000Z" });
    expect(snapshot?.measurements.find((measurement) => measurement.id === "launch_window_gap_months"))
      .toMatchObject({ value: 12 });
    expect(snapshot?.signals.find((signal) => signal.id === "launch_boundary_gap")?.finding)
      .not.toContain("1900");
    expect(JSON.stringify(snapshot)).not.toContain("Attacker-selected");
  });

  it("builds bounded divergence, chain, control, treasury, and supply screens", () => {
    const evidence = projectEvidence();
    addCanonicalToken(evidence);
    evidence.projectToken!.marketCapUsd = 25_000_000;
    evidence.projectToken!.fdvUsd = 75_000_000;
    evidence.projectToken!.circulatingSupply = 25;
    evidence.projectToken!.totalSupply = 100;
    addProtocolTvl(evidence);
    evidence.protocolFees = {
      slug: "fixture",
      binding: { canonicalGeckoId: "fixture", protocolSlug: "fixture", method: "matched_protocol_gecko_id" },
      total24hUsd: 20_000,
      total30dUsd: 600_000,
      change30dOver30dPct: 30,
      sourceUrl: "https://defillama.example.test/fees/fixture",
      capturedAt: "2026-08-05T12:25:00.000Z",
    };

    const snapshot = buildPointInTimeIntelligence(evidence);
    const ids = snapshot?.signals.map((signal) => signal.id) ?? [];

    expect(ids).toEqual(expect.arrayContaining([
      "usage_capital_divergence",
      "protocol_fee_intensity",
      "chain_dependency",
      "governance_control_gap",
      "treasury_gap_at_scale",
      "reported_supply_overhang",
    ]));
    expect(snapshot?.signals.find((signal) => signal.id === "usage_capital_divergence")?.arithmetic?.[0]?.temporal)
      .toMatchObject({ state: "aligned", maxInputSkewHours: 0.0833 });
    expect(snapshot?.signals.find((signal) => signal.id === "protocol_fee_intensity")?.arithmetic?.[0]?.temporal)
      .toMatchObject({ state: "aligned", maxInputSkewHours: 0.0833 });
    expect(snapshot?.signals.find((signal) => signal.id === "reported_supply_overhang")?.arithmetic?.[0]).toEqual({
      expression: "fdv_usd / market_cap_usd",
      value: 3,
      unit: "ratio",
      inputMeasurementIds: ["fdv_usd", "market_cap_usd"],
      temporal: {
        state: "aligned",
        maxInputSkewHours: 0,
        inputAsOf: [
          { measurementId: "circulating_supply_pct", asOf: "2026-08-05T12:10:00.000Z" },
          { measurementId: "fdv_usd", asOf: "2026-08-05T12:10:00.000Z" },
          { measurementId: "market_cap_usd", asOf: "2026-08-05T12:10:00.000Z" },
        ],
      },
    });
    expect(snapshot?.coverage).toHaveLength(14);
  });

  it("keeps verified adverse findings in every lens with a semantically correct domain", () => {
    const cases = [
      ["ProjectTokenDrawdown", "market"],
      ["SiteNotLive", "product"],
      ["OfficialXAccountSuspended", "identity"],
      ["ProtocolSecurityIncident", "security"],
    ] as const;

    for (const [findingType, domain] of cases) {
      const evidence = projectEvidence();
      evidence.findings = [{
        finding_type: findingType,
        claim: `${findingType} verified adverse claim`,
        source_url: `https://evidence.example.test/${findingType}`,
        source_date: "2026-08-01",
        verification_status: "Verified",
        independent_source_count: 1,
        polarity: -1,
        evidence_origin: "deterministic",
        artifact_verified: true,
        provider: "test",
        finding_scope: {
          scope: "direct_subject",
          target_entity_key: "@argusfixture",
          target_entity_type: "project",
          relationship_to_subject: "self",
        },
      }];

      const snapshot = buildPointInTimeIntelligence(evidence);
      const signal = snapshot?.signals.find((candidate) => candidate.id === "verified_adverse_finding:001");

      expect(signal, findingType).toMatchObject({ domain, polarity: "risk" });
      expect(signal?.lenses, findingType).toEqual([
        "alpha_research",
        "counterparty",
        "general_diligence",
        "investment",
      ]);
      for (const lens of snapshot?.lenses ?? []) {
        expect(lens.signalIds, `${findingType}:${lens.id}`).toContain(signal?.id);
      }
    }
  });

  it("carries exact provider flags and emits bounded market-regime signals", () => {
    const evidence = projectEvidence();
    addCanonicalToken(evidence);
    evidence.projectToken!.ath = { priceUsd: 10, date: "2025-01-02", drawdownPct: -80 };
    evidence.projectToken!.history = {
      points: [1, 1.2],
      first: 1,
      last: 1.2,
      peak: 1.2,
      changePct: 20,
      drawdownPct: 0,
      spanPeriods: 1,
      windowIsPartial: false,
      volume: {
        recent: { usd: 100, candles: 1, measured: 1 },
        prior: { usd: 200, candles: 1, measured: 1 },
        changePct: -50,
        isFloor: false,
      },
      timeframe: "day",
      poolAddress: "0xpool",
    };
    evidence.holderProfile = {
      binding: { canonicalAddress: evidence.projectToken!.address, chain: evidence.projectToken!.chain, method: "canonical_token_address_chain" },
      topHolderPct: null,
      top10Pct: null,
      holderCount: 1_000,
      lpLockedOrBurnedPct: null,
      holdersAssessed: false,
      distributionSource: null,
      distributionNote: "No ordered distribution was available.",
      contractFlags: [{
        key: "mint_authority_active",
        claim: "GoPlus says the contract retains a mint capability.",
        tone: "bad",
        source: "goplus",
      }],
      creatorPct: null,
      sourceUrl: "https://goplus.example.test/token",
      sourceCapturedAt: "2026-08-05T12:30:00.000Z",
      capturedAt: "2026-08-05T12:30:00.000Z",
    };

    const snapshot = buildPointInTimeIntelligence(evidence);
    const flag = snapshot?.signals.find((signal) => signal.id.startsWith("goplus_contract_flag:"));
    const drawdown = snapshot?.signals.find((signal) => signal.id === "reported_lifetime_high_distance");
    const divergence = snapshot?.signals.find((signal) => signal.id === "price_volume_regime_divergence");

    expect(flag).toMatchObject({ severity: "high", evidenceState: "reported_context", sourceRefs: ["snapshot:holder-profile"] });
    expect(flag?.finding).toContain("GoPlus says the contract retains a mint capability.");
    expect(flag?.finding).toContain("does not independently authenticate");
    expect(drawdown?.finding).toContain("not evidence of undervaluation");
    expect(divergence?.finding).toContain("Aggregate volume is not directional order flow");
  });

  it("adds explicit receipts for capital-to-fee scale and launch-boundary context", () => {
    const evidence = projectEvidence();
    addCanonicalToken(evidence);
    evidence.protocolFunding = {
      slug: "fixture",
      name: "Fixture",
      geckoId: "fixture",
      rounds: [{ date: "2025-01-01", round: "Seed", amountUsd: 10_000_000, leadInvestors: ["Lead Fund"], otherInvestors: [], valuationUsd: 50_000_000 }],
      totalRaisedUsd: 10_000_000,
      leadInvestors: ["Lead Fund"],
      sourceUrl: "https://defillama.example.test/raises/fixture",
      capturedAt: "2026-08-05T12:30:00.000Z",
    };
    evidence.protocolFees = {
      slug: "fixture",
      binding: { canonicalGeckoId: "fixture", protocolSlug: "fixture", method: "matched_protocol_gecko_id" },
      total24hUsd: 30_000,
      total30dUsd: 1_000_000,
      sourceUrl: "https://defillama.example.test/fees/fixture",
      capturedAt: "2026-08-05T12:31:00.000Z",
    };
    evidence.profile.website = "https://fixture.example";
    evidence.profile.profile_collection_state = "resolved";
    evidence.profile.profile_provider = "twitterapi";
    evidence.profile.profile_captured_at = "2026-08-05T12:00:00.000Z";
    evidence.profile.account_created_at = "2021-01-01T00:00:00.000Z";
    evidence.domainRegistration = {
      domain: "fixture.example",
      hostname: "fixture.example",
      registeredAt: "2020-01-01T00:00:00.000Z",
      ageMonths: 79,
      source: "https://rdap.org/domain/fixture.example",
      capturedAt: "2026-08-05T12:01:00.000Z",
    };
    evidence.launchWindow = {
      earliest: "2020-01-01T00:00:00.000Z",
      earliestSource: "domain",
      latest: "2021-01-01T00:00:00.000Z",
      latestSource: "account",
      gapMonths: 12,
      summary: "The domain boundary precedes the account boundary by twelve months.",
    };

    const snapshot = buildPointInTimeIntelligence(evidence);
    const capital = snapshot?.signals.find((signal) => signal.id === "disclosed_capital_to_fee_scale");
    const chronology = snapshot?.signals.find((signal) => signal.id === "launch_boundary_gap");

    expect(capital?.arithmetic).toEqual([{
      expression: "protocol_fees_30d_usd * 12 / indexed_disclosed_round_sum_usd",
      value: 1.2,
      unit: "ratio",
      inputMeasurementIds: ["protocol_fees_30d_usd", "indexed_disclosed_round_sum_usd"],
      temporal: {
        state: "aligned",
        maxInputSkewHours: 0.0167,
        inputAsOf: [
          { measurementId: "protocol_fees_30d_usd", asOf: "2026-08-05T12:31:00.000Z" },
          { measurementId: "indexed_disclosed_round_sum_usd", asOf: "2026-08-05T12:30:00.000Z" },
        ],
      },
    }]);
    expect(capital?.finding).toContain("not protocol revenue, profit, treasury cash, valuation, or investor return");
    expect(chronology?.finding).toContain("not a proved founding date, hidden relaunch, or deception finding");
  });

  it("flags the unresolved scope bridge between an authentic audit engagement and current proxy code", () => {
    const evidence = projectEvidence();
    addObservedEvmControl(evidence);
    addCanonicalToken(evidence);
    evidence.projectToken!.address = evidence.evmControlReality!.target;
    evidence.securityAudits = {
      securityPageUrl: null,
      selfAttested: ["Audit Firm"],
      attestations: [{ auditor: "Audit Firm", origin: "subject_page", sourceUrl: "https://fixture.example.test/security" }],
      corroborated: [{
        auditor: "Audit Firm",
        auditorUrl: "https://auditor.example.test/fixture",
        excerpt: "Audit Firm completed a security review of the canonical contract.",
        matchedIdentityAnchor: { type: "canonical_contract", value: evidence.evmControlReality!.target },
      }],
      capturedAt: "2026-08-05T12:40:00.000Z",
    };

    const signal = buildPointInTimeIntelligence(evidence)?.signals
      .find((candidate) => candidate.id === "audit_to_deployment_scope_gap");

    expect(signal).toMatchObject({ kind: "coverage_gap", domain: "security", polarity: "unknown" });
    expect(signal?.finding).toContain("does not establish that the code executing at the captured block was in scope or remediated");
    expect(signal?.sourceRefs).toEqual([
      "audit:corroborated:01",
      "snapshot:evm-control-reality",
      "snapshot:security-audits",
    ]);
  });

  it("keeps legal and sanctions name matches as identity-resolution gaps, never adverse claims", () => {
    const evidence = projectEvidence();
    evidence.sourceArtifacts = [{
      kind: "legal_case",
      provider: "courtlistener",
      title: "Case caption containing Argus Fixture",
      sourceUrl: "https://courtlistener.example.test/case/1",
      capturedAt: CAPTURED_AT,
      contentHash: "a".repeat(64),
      excerpt: "Argus Fixture appears in a case caption.",
      match: "exact_name",
    }, {
      kind: "sanctions_screen",
      provider: "opensanctions",
      title: "Dataset name candidate",
      sourceUrl: "https://opensanctions.example.test/entity/1",
      capturedAt: CAPTURED_AT,
      contentHash: "b".repeat(64),
      excerpt: "The dataset contains the same display name.",
      match: "exact_name",
    }, {
      kind: "sanctions_screen",
      provider: "opensanctions",
      title: "Bounded clear screen",
      capturedAt: CAPTURED_AT,
      contentHash: "c".repeat(64),
      match: "screened_clear",
    }];

    const snapshot = buildPointInTimeIntelligence(evidence)!;
    const legal = snapshot.signals.find((signal) => signal.id === "legal_case_identity_resolution_gap");
    const sanctions = snapshot.signals.find((signal) => signal.id === "sanctions_screen_identity_resolution_gap");

    expect(legal).toMatchObject({ kind: "coverage_gap", polarity: "unknown", evidenceState: "reported_context" });
    expect(sanctions).toMatchObject({ kind: "coverage_gap", polarity: "unknown", evidenceState: "reported_context" });
    expect(`${legal?.finding} ${sanctions?.finding}`).toContain("does not bind");
    expect(`${legal?.finding} ${sanctions?.finding}`).toContain("no allegation");
    expect(snapshot.sources.find((source) => source.id === "source-artifact:003")?.evidenceState).toBe("bounded");
    expect(snapshot.signals.some((signal) =>
      signal.sourceRefs.includes("source-artifact:003")
      && (signal.polarity === "support" || signal.polarity === "risk"),
    )).toBe(false);
    expect(snapshot.questions.find((question) => question.id === "project.legal_regulatory"))
      .toMatchObject({ state: "not_collected", materiality: "critical" });
  });

  it("attributes profile-image review leads to the provider and rejects contradictory provider flags", () => {
    const evidence = projectEvidence();
    evidence.profileAuthenticity = {
      provider: "claude-vision",
      capturedAt: CAPTURED_AT,
      imageUrl: "https://images.example.test/avatar.png",
      imageContentHash: "d".repeat(64),
      classification: "ai_generated",
      confidence: 0.94,
      isRealPerson: false,
      flag: true,
      tells: ["warped earring", "melted background"],
      note: "Visible synthetic-image indicators warrant review.",
    };

    const snapshot = buildPointInTimeIntelligence(evidence)!;
    const lead = snapshot.signals.find((signal) => signal.id === "provider_profile_photo_review_lead");
    expect(lead).toMatchObject({ kind: "screening_heuristic", polarity: "unknown", evidenceState: "reported_context" });
    expect(lead?.headline).toContain("claude-vision");
    expect(lead?.finding).toContain("provider's visual-screening opinion");
    expect(lead?.finding).toContain("not identity proof");

    const inconsistent = structuredClone(evidence);
    inconsistent.profileAuthenticity!.flag = false;
    const inconsistentSnapshot = buildPointInTimeIntelligence(inconsistent)!;
    expect(inconsistentSnapshot.signals.find((signal) => signal.id === "provider_profile_photo_review_lead")).toBeUndefined();
    expect(inconsistentSnapshot.signals.find((signal) => signal.id === "profile_photo_screen_integrity_gap"))
      .toMatchObject({ kind: "coverage_gap", polarity: "unknown" });

    const clear = structuredClone(evidence);
    clear.profileAuthenticity = {
      ...clear.profileAuthenticity!,
      classification: "real_candid",
      flag: false,
      isRealPerson: true,
    };
    expect(buildPointInTimeIntelligence(clear)!.signals.some((signal) =>
      signal.sourceRefs.includes("snapshot:profile-authenticity")
      && signal.polarity === "support",
    )).toBe(false);
  });

  it("admits trust-graph risk only for exact complete server-collected adverse relationships", () => {
    const evidence = projectEvidence();
    evidence.trustGraphScreen = {
      provider: "argus-graph",
      capturedAt: CAPTURED_AT,
      status: "risk",
      contributionCount: 4,
      qualifiedContributionCount: 3,
      sourceContentHash: "e".repeat(64),
      severity: "caution",
      line: "One exact connection reaches a prior adverse report.",
      connections: [{
        other: "@adversefixture",
        otherReportVersionId: "123e4567-e89b-42d3-a456-426614174000",
        otherAttestation: "server_collected",
        otherCompleteness: "complete",
        otherVerdict: "AVOID",
        qualified: true,
        direct: false,
        ties: [{
          key: "person:shared-operator",
          label: "shared operator",
          type: "Person",
          strength: "medium",
          subjectEdgeTypes: ["TEAM"],
          otherEdgeTypes: ["TEAM"],
        }],
      }],
    };

    const signal = buildPointInTimeIntelligence(evidence)!.signals
      .find((candidate) => candidate.id === "qualified_adverse_trust_graph_relationship");
    expect(signal).toMatchObject({ kind: "observation", polarity: "risk", evidenceState: "verified" });
    expect(signal?.finding).toContain("complete server-collected");
    expect(signal?.finding).toContain("does not establish participation");

    const invalidVariants: CollectedEvidence[] = [
      (() => {
        const next = structuredClone(evidence);
        next.trustGraphScreen!.connections[0]!.qualified = false;
        return next;
      })(),
      (() => {
        const next = structuredClone(evidence);
        next.trustGraphScreen!.connections[0]!.otherAttestation = "analyst_submitted";
        return next;
      })(),
      (() => {
        const next = structuredClone(evidence);
        next.trustGraphScreen!.connections[0]!.otherCompleteness = "partial";
        return next;
      })(),
      (() => {
        const next = structuredClone(evidence);
        next.trustGraphScreen!.connections[0]!.ties[0]!.strength = "weak";
        return next;
      })(),
    ];
    for (const invalid of invalidVariants) {
      const invalidSnapshot = buildPointInTimeIntelligence(invalid)!;
      expect(invalidSnapshot.signals.find((candidate) => candidate.id === "qualified_adverse_trust_graph_relationship")).toBeUndefined();
      expect(invalidSnapshot.measurements.find((row) => row.id === "qualified_adverse_trust_graph_connection_count")).toBeUndefined();
      expect(invalidSnapshot.signals.find((candidate) => candidate.id === "trust_graph_receipt_integrity_gap"))
        .toMatchObject({ polarity: "unknown" });
    }
  });

  it("uses only direct verified axis records as counter-evidence and keeps checked-empty rows non-supportive", () => {
    const evidence = projectEvidence();
    evidence.axisCitationVersion = 1;
    evidence.axisEvidenceCatalog = [{
      artifactId: "direct-counter",
      kind: "axis_evidence",
      provider: "public-web",
      operation: "basicFacts:legal_regulatory_event",
      section: "basicFacts",
      title: "Verified direct regulatory record",
      excerpt: "A controlling registry records an unresolved direct-subject regulatory event.",
      sourceUrl: "https://registry.example.test/event/1",
      capturedAt: CAPTURED_AT,
      contentHash: "1".repeat(64),
      eligibleAxes: ["P6_transparency_integrity"],
      counterEligibleAxes: ["P6_transparency_integrity"],
      verification: "verified",
      scope: "direct_subject",
    }, {
      artifactId: "related-counter",
      kind: "axis_evidence",
      provider: "public-web",
      operation: "basicFacts:legal_regulatory_event",
      section: "basicFacts",
      title: "Related-entity record",
      contentHash: "2".repeat(64),
      eligibleAxes: ["P6_transparency_integrity"],
      counterEligibleAxes: ["P6_transparency_integrity"],
      verification: "verified",
      scope: "subject_context",
    }, {
      artifactId: "checked-empty",
      kind: "axis_evidence",
      provider: "opensanctions",
      operation: "sourceArtifacts:sanctions_screen",
      section: "sourceArtifacts",
      title: "Bounded clear provider screen",
      contentHash: "3".repeat(64),
      eligibleAxes: ["P6_transparency_integrity"],
      counterEligibleAxes: ["P6_transparency_integrity"],
      verification: "checked_empty",
      scope: "direct_subject",
    }, {
      artifactId: "missing-regulatory-scope",
      kind: "axis_evidence",
      provider: "public-web",
      operation: "axisGaps:P6_transparency_integrity",
      section: "axisGaps",
      title: "Legal-entity jurisdiction remains unresolved",
      excerpt: "Which jurisdictions and controlling entities govern the offered activity?",
      contentHash: "4".repeat(64),
      eligibleAxes: ["P6_transparency_integrity"],
      verification: "unavailable",
      scope: "direct_subject",
    }];
    evidence.axes = [{
      axis: "P6_transparency_integrity",
      score: 1,
      rationale: "One verified counter record and unresolved legal scope.",
      evidenceRefs: [],
      counterEvidenceRefs: ["direct-counter", "related-counter", "checked-empty"],
      gaps: ["Which jurisdictions and controlling entities govern the offered activity?"],
    }];
    evidence.projectStrengthBands = {
      P6_transparency_integrity: {
        tier: "adverse",
        minScore: 0,
        maxScore: 3,
        reasons: ["A verified direct-subject counter record constrains the band."],
        anchorArtifactIds: ["direct-counter"],
      },
    };

    const snapshot = buildPointInTimeIntelligence(evidence)!;
    const counter = snapshot.signals.find((signal) => signal.id === "verified_axis_counter_evidence:P6_transparency_integrity");
    const integrity = snapshot.signals.find((signal) => signal.id === "axis_counter_evidence_integrity_gap:P6_transparency_integrity");
    const gap = snapshot.signals.find((signal) => signal.id === "analyst_axis_gap:P6_transparency_integrity");

    expect(counter).toMatchObject({ polarity: "mixed", evidenceState: "verified" });
    expect(counter?.sourceRefs).toEqual(["axis-evidence:direct-counter"]);
    expect(integrity?.sourceRefs).toEqual([
      "axis-assessment:P6_transparency_integrity",
      "axis-evidence:checked-empty",
      "axis-evidence:related-counter",
    ]);
    expect(gap?.sourceRefs).toEqual([
      "axis-assessment:P6_transparency_integrity",
      "axis-evidence:missing-regulatory-scope",
    ]);
    expect(snapshot.signals.some((signal) =>
      signal.sourceRefs.includes("axis-evidence:checked-empty")
      && signal.polarity === "support",
    )).toBe(false);
    expect(snapshot.measurements.find((row) => row.id === "project_strength_tier:P6_transparency_integrity"))
      .toMatchObject({ value: "adverse", evidenceState: "reported_context" });
    expect(snapshot.signals.find((signal) => signal.id === "project_strength_band_summary")?.finding)
      .toContain("not new factual findings");
    const sourceIds = new Set(snapshot.sources.map((source) => source.id));
    for (const measurement of snapshot.measurements) {
      expect(measurement.sourceRefs.length, measurement.id).toBeGreaterThan(0);
      expect(measurement.sourceRefs.every((sourceRef) => sourceIds.has(sourceRef)), measurement.id).toBe(true);
    }
  });

  it("retains model contradiction rows only as artifact-resolution leads", () => {
    const evidence = projectEvidence();
    evidence.contradictions = [{
      claim: "The product is fully decentralized.",
      conflict: "A separate analyst field described an administrator.",
      severity: "high",
      confidence: "high",
    }];

    const snapshot = buildPointInTimeIntelligence(evidence)!;
    const lead = snapshot.signals.find((signal) => signal.id === "analyst_contradiction_artifact_gap");
    expect(lead).toMatchObject({ kind: "coverage_gap", polarity: "unknown", evidenceState: "reported_context" });
    expect(lead?.finding).toContain("does not claim that saved artifacts actually conflict");
    expect(snapshot.sources.find((source) => source.id === "contradiction-lead:001"))
      .toMatchObject({ evidenceState: "reported_context", provider: "analyst-contradiction-review" });
    expect(snapshot.signals.some((signal) => signal.id.startsWith("basic_fact_conflict:"))).toBe(false);
  });

  it("surfaces exact-handle portfolio relationships and strict fund scale without conflating either with quality or personal capital", () => {
    const evidence = projectEvidence();
    evidence.profile.profile_collection_state = "resolved";
    evidence.profile.profile_provider = "twitterapi";
    evidence.profile.profile_captured_at = CAPTURED_AT;
    evidence.profile.website = "https://fund.example/";
    evidence.profile.display_name = "Argus Fixture";
    evidence.sourceArtifacts = [{
      kind: "portfolio_relationship",
      provider: "portfolio-web",
      title: "Official investment record",
      sourceUrl: "https://fund.example/portfolio/target",
      capturedAt: CAPTURED_AT,
      contentHash: "5".repeat(64),
      sourceContentHash: "5".repeat(64),
      excerpt: "Argus Fixture invested in Target Project.",
      match: "relationship_confirmed",
      relationship: "invested_in",
      attribution: "direct_subject",
      subjectName: "Argus Fixture",
      subjectHandle: "@argusfixture",
      investorEntityName: "Argus Fixture",
      investorEntityDomain: "fund.example",
      projectName: "Target Project",
      projectHandle: "@targetproject",
      projectDomain: "target.example",
      sourceClass: "first_party_subject",
    }, {
      kind: "portfolio_relationship",
      provider: "portfolio-web",
      title: "Namesake investment candidate",
      sourceUrl: "https://fund.example/portfolio/other",
      capturedAt: CAPTURED_AT,
      contentHash: "6".repeat(64),
      match: "relationship_confirmed",
      relationship: "invested_in",
      attribution: "direct_subject",
      subjectName: "Argus Fixture",
      subjectHandle: "@differentfixture",
      projectName: "Other Project",
      sourceClass: "first_party_subject",
    }, {
      kind: "fund_scale",
      provider: "fund-scale-web",
      title: "Fund I final close",
      sourceUrl: "https://fund.example/fund-i",
      capturedAt: CAPTURED_AT,
      contentHash: "7".repeat(64),
      sourceContentHash: "8".repeat(64),
      excerpt: "Argus Fixture Fund I closed at $125 million.",
      match: "fund_scale_confirmed",
      sourceClass: "first_party_subject",
      attribution: "direct_subject",
      subjectName: "Argus Fixture",
      subjectHandle: "@argusfixture",
      investorEntityName: "Argus Fixture",
      investorEntityDomain: "fund.example",
      fundName: "Argus Fixture",
      fundSizeUsd: 125_000_000,
      fundVehicle: "Fund I",
      fundScaleMetric: "final_close",
      fundAmountQualifier: "exact",
      fundScaleBasis: "manager_reported",
      fundScaleTemporalState: "fixed_historical",
      fundScaleSourceCount: 1,
      fundScaleClaimId: "fund-i-final-close",
    }];

    const snapshot = buildPointInTimeIntelligence(evidence)!;
    const relationship = snapshot.signals.find((signal) => signal.id === "confirmed_portfolio_relationship:001");
    const fundScale = snapshot.signals.find((signal) => signal.id === "verified_fund_scale:01");
    expect(relationship).toMatchObject({ polarity: "neutral", evidenceState: "verified" });
    expect(relationship?.finding).toContain("does not establish endorsement");
    expect(snapshot.signals.find((signal) => signal.id === "confirmed_portfolio_relationship:002")).toBeUndefined();
    // A manager-reported close on the fund's own domain is identity-bound but
    // self-published, so it stays attributed context here exactly as it does
    // in the entity builder. The two must never tier the same artifact
    // differently.
    expect(fundScale).toMatchObject({ polarity: "neutral", evidenceState: "reported_context" });
    expect(fundScale?.finding).toContain("not the audited person's personal capital");
    expect(fundScale?.finding).toContain("reported by the manager");
    expect(snapshot.measurements.find((row) => row.id === "verified_fund_scale_usd:01"))
      .toMatchObject({ value: 125_000_000, evidenceState: "reported_context" });
    expect(snapshot.measurements.find((row) => row.id === "verified_fund_scale_claim_count"))
      .toMatchObject({ evidenceState: "reported_context" });
  });

  it("reaches the verified tier for a fund-scale claim resting on a regulatory filing", () => {
    const evidence = projectEvidence();
    evidence.profile.profile_collection_state = "resolved";
    evidence.profile.profile_provider = "twitterapi";
    evidence.profile.profile_captured_at = CAPTURED_AT;
    evidence.profile.website = "https://fund.example/";
    evidence.profile.display_name = "Argus Fixture";
    evidence.sourceArtifacts = [{
      kind: "fund_scale",
      provider: "fund-scale-web",
      title: "Adviser regulatory AUM",
      sourceUrl: "https://adviserinfo.sec.gov/firm/summary/123456",
      capturedAt: CAPTURED_AT,
      contentHash: "7".repeat(64),
      sourceContentHash: "8".repeat(64),
      excerpt: "Argus Fixture reports regulatory assets under management of $125 million.",
      match: "fund_scale_confirmed",
      sourceClass: "public_primary",
      attribution: "direct_subject",
      subjectName: "Argus Fixture",
      subjectHandle: "@argusfixture",
      investorEntityName: "Argus Fixture",
      investorEntityDomain: "fund.example",
      fundName: "Argus Fixture",
      fundSizeUsd: 125_000_000,
      fundVehicle: "Fund I",
      fundScaleMetric: "regulatory_aum",
      fundAmountQualifier: "exact",
      fundScaleBasis: "regulatory",
      fundScaleTemporalState: "current",
      fundScaleAsOf: CAPTURED_AT,
      fundScaleSourceCount: 1,
      fundScaleClaimId: "fund-i-final-close",
    }];

    const snapshot = buildPointInTimeIntelligence(evidence)!;
    expect(snapshot.signals.find((signal) => signal.id === "verified_fund_scale:01"))
      .toMatchObject({ evidenceState: "verified" });
    expect(snapshot.measurements.find((row) => row.id === "verified_fund_scale_usd:01"))
      .toMatchObject({ value: 125_000_000, evidenceState: "verified" });
  });
});
