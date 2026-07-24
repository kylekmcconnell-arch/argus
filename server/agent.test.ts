import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ANALYST_EVIDENCE_MAX_CHARS,
  FOUNDER_SCORING_POLICY,
  PROJECT_SCORING_POLICY,
  RECORD_VERDICT_INPUT_SCHEMA,
  analyzeSubject,
  analystAvailable,
  buildAnalystEvidencePacket,
  buildScoringEvidencePacket,
  deriveProjectStrengthBands,
  extractScoringEvidenceCatalog,
  inspectAnalystScoringPreflight,
  normalizeAnalystCitationEligibility,
  normalizeAnalystSupportCounterOverlap,
  projectScoreFloorsForPacket,
  scanContradictions,
  scoringPolicyForAxes,
  structured,
  validateAnalystVerdict,
  type AnalystAxis,
} from "./agent";
import type { AxisEvidenceRecord, SourceArtifact } from "../src/data/evidence";
import { getProfile, SubjectClass } from "../src/engine";
import { ANALYST_REPAIR_TIMEOUT_MS, ANALYST_SCORING_TIMEOUT_MS } from "../src/lib/investigationRuntime";
import { getCost, withCostLedger } from "./cost";
// Prompt-caching wraps system and user prompts in content-block arrays;
// tests read them back as plain text regardless of shape.
const promptText = (value: unknown): string => Array.isArray(value)
  ? value.map((block) => String((block as { text?: unknown }).text ?? "")).join("\n")
  : String(value ?? "");


const catalog: AnalystAxis[] = [
  { axis: "F1_identity_verifiability", weight: 12, role: "FOUNDER" },
  { axis: "F2_track_record", weight: 28, role: "FOUNDER" },
];

const F1_REF = `art_v1_${"1".repeat(64)}`;
const F2_REF = `art_v1_${"2".repeat(64)}`;
const F2_COUNTER_REF = `art_v1_${"3".repeat(64)}`;
const F2_UNAVAILABLE_REF = `art_v1_${"4".repeat(64)}`;
const F2_CHECKED_EMPTY_REF = `art_v1_${"5".repeat(64)}`;
const ARTIFACT_ID_FOR_TEST = /^art_v1_[a-f0-9]{64}$/;

const verifiedFundScaleArtifact = (overrides: Partial<SourceArtifact> = {}): SourceArtifact => ({
  kind: "fund_scale",
  provider: "fund-scale-web",
  title: "Subject closed a $500 million fund",
  excerpt: "Subject announced a completed $500 million venture fund.",
  sourceUrl: "https://subject.example/fund-size",
  capturedAt: "2026-07-11T12:00:00.000Z",
  contentHash: "a".repeat(64),
  sourceContentHash: "b".repeat(64),
  match: "fund_scale_confirmed",
  subjectName: "Subject",
  subjectHandle: "@subject",
  investorEntityName: "Subject",
  investorEntityDomain: "subject.example",
  attribution: "direct_subject",
  sourceClass: "first_party_subject",
  fundName: "Subject",
  fundSizeUsd: 500_000_000,
  fundVehicle: "Subject Venture Fund I",
  fundScaleMetric: "fund_vehicle",
  fundAmountQualifier: "exact",
  fundScaleBasis: "manager_reported",
  fundScaleTemporalState: "fixed_historical",
  fundScaleSourceCount: 1,
  fundScaleClaimId: "fund_scale_claim_v1_subject_fund_i",
  ...overrides,
});

const axisArtifact = (
  artifactId: string,
  eligibleAxes: string[],
  verification: AxisEvidenceRecord["verification"] = "verified",
  counterEligibleAxes?: string[],
): AxisEvidenceRecord => ({
  artifactId,
  kind: "axis_evidence",
  provider: "test-provider",
  operation: "test-operation",
  section: "test",
  title: "Test evidence",
  contentHash: artifactId.slice("art_v1_".length),
  eligibleAxes,
  verification,
  ...(counterEligibleAxes ? { counterEligibleAxes } : {}),
  scope: "direct_subject",
});

const validationCatalog: AxisEvidenceRecord[] = [
  axisArtifact(F1_REF, [catalog[0].axis]),
  axisArtifact(F2_REF, [catalog[1].axis]),
  axisArtifact(F2_COUNTER_REF, [catalog[1].axis], "reported"),
  {
    ...axisArtifact(F2_UNAVAILABLE_REF, [catalog[1].axis], "unavailable"),
    provider: "track-record-provider",
    operation: "track-record-search",
    title: "Track record provider unavailable",
  },
  axisArtifact(F2_CHECKED_EMPTY_REF, [catalog[1].axis], "checked_empty"),
];

const validAxis = (axis: string, score: number, ref: string) => ({
  axis,
  score,
  rationale: "Evidence-backed rationale",
  primaryEvidenceRef: ref,
  additionalEvidenceRefs: [] as string[],
  counterEvidenceRefs: [] as string[],
  coverageRefs: [] as string[],
  gaps: [] as string[],
});

describe("analyst verdict integrity", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("keeps the strict verdict grammar shallow, invariant, and fully required", () => {
    const metrics = {
      objects: 0,
      properties: 0,
      arrays: 0,
      enums: 0,
      optional: 0,
      unions: 0,
    };
    const inspect = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) {
        value.forEach(inspect);
        return;
      }
      const record = value as Record<string, unknown>;
      if (record.type === "object") {
        metrics.objects += 1;
        expect(record.additionalProperties).toBe(false);
        const properties = record.properties as Record<string, unknown>;
        const required = Array.isArray(record.required) ? record.required as string[] : [];
        metrics.properties += Object.keys(properties).length;
        metrics.optional += Object.keys(properties).filter((key) => !required.includes(key)).length;
      }
      if (record.type === "array") metrics.arrays += 1;
      if (Array.isArray(record.type)) metrics.unions += 1;
      if (Array.isArray(record.enum)) metrics.enums += 1;
      if (Array.isArray(record.anyOf) || Array.isArray(record.oneOf)) metrics.unions += 1;
      Object.values(record).forEach(inspect);
    };
    inspect(RECORD_VERDICT_INPUT_SCHEMA);

    const structuralSchema = JSON.stringify(RECORD_VERDICT_INPUT_SCHEMA, (key, value) =>
      key === "description" ? undefined : value);
    expect(Buffer.byteLength(JSON.stringify(RECORD_VERDICT_INPUT_SCHEMA))).toBeLessThan(2_048);
    expect(Buffer.byteLength(structuralSchema)).toBeLessThan(1_000);
    expect(metrics).toEqual({
      objects: 2,
      properties: 11,
      arrays: 5,
      enums: 0,
      optional: 0,
      unions: 0,
    });
  });

  it("separates project fundamentals from collection confidence with an explicit scoring rubric", () => {
    const projectAxes: AnalystAxis[] = Object.entries(getProfile(SubjectClass.PROJECT).axes)
      .map(([axis, weight]) => ({ axis, weight, role: SubjectClass.PROJECT }));

    expect(scoringPolicyForAxes(projectAxes)).toBe(PROJECT_SCORING_POLICY);
    expect(scoringPolicyForAxes(catalog)).toBe(FOUNDER_SCORING_POLICY);
    expect(PROJECT_SCORING_POLICY).toContain("Keep score and confidence separate");
    expect(PROJECT_SCORING_POLICY).toContain("Missing coverage is separate and never creates or lowers a strength tier");
    expect(PROJECT_SCORING_POLICY).toContain("A bootstrapped project is not weaker merely because no VC round was found");
    expect(PROJECT_SCORING_POLICY).toContain("Missing LinkedIn profiles, full legal names, or a complete staff directory are confidence gaps");
    expect(PROJECT_SCORING_POLICY).toContain("Only cite substantive counterEvidenceRefs for distinct verified facts that pull a score below its evidence-strength band");
    expect(FOUNDER_SCORING_POLICY).toContain("Follower count, posting cadence, profile biography, fame, and X follow relationships never establish a founder role or track record");
    expect(FOUNDER_SCORING_POLICY).toContain("A personal GitHub account is optional and its absence cannot negate a verified live product");
    expect(FOUNDER_SCORING_POLICY).toContain("Social follows, mutual follows, and generic affiliations are network context, not repeat backing");
  });

  it("derives exceptional evidence bands for established projects without using fame or artifact counts", () => {
    const axes: AnalystAxis[] = Object.entries(getProfile(SubjectClass.PROJECT).axes)
      .map(([axis, weight]) => ({ axis, weight, role: SubjectClass.PROJECT }));
    const packet = buildScoringEvidencePacket({
      profile: {
        handle: "@established_project",
        display_name: "Established Project",
        website: "https://established.example",
        days_since_post: 0,
        profile_collection_state: "resolved",
        profile_provider: "twitterapi",
        profile_captured_at: "2026-07-12T12:00:00.000Z",
      },
      team: [
        { name: "Founder One", role: "Co-founder", provider: "team-page", artifact_verified: true },
        { name: "Founder Two", role: "Co-founder", provider: "team-page", artifact_verified: true },
      ],
      basicFacts: [
        { predicate: "legal_entity", value: "Established Labs S.A.", status: "verified", artifact_verified: true },
        { predicate: "official_identity", value: "Established Project", status: "verified", artifact_verified: true },
        { predicate: "repository", value: "github.com/example/established", status: "verified", artifact_verified: true },
        { predicate: "governance", value: "Token-holder governance", status: "verified", artifact_verified: true },
        { predicate: "tokenomics", value: "Published token allocation and supply schedule", status: "verified", artifact_verified: true },
        { predicate: "audit", value: "Independent protocol audit", status: "verified", artifact_verified: true },
        { predicate: "investor", value: "Jump Crypto disclosed as a strategic backer", status: "verified", artifact_verified: true },
        { predicate: "traction", value: "$25M verified daily protocol volume", qualifier: "as of 2026-07-10", status: "verified", artifact_verified: true },
      ],
      projectToken: {
        verified: true,
        verification: "official_domain",
        name: "Established Project",
        symbol: "EST",
        coingeckoId: "established-project",
        rank: 75,
        address: "0x0000000000000000000000000000000000000e57",
        chain: "ethereum",
        sourceUrl: "https://established.example/token",
        capturedAt: "2026-07-12T12:00:00.000Z",
        providers: ["coingecko", "dexscreener", "geckoterminal"],
        marketCapUsd: 662_000_000,
        volume24hUsd: 18_000_000,
        liquidityUsd: 1_100_000,
      },
      recentActivity: [{
        provider: "twitterapi",
        text: "Released a production protocol upgrade and published current operating metrics.",
      }],
      sourceArtifacts: [{
        kind: "press",
        provider: "google-news",
        title: "Securitize, Jump, Established Project launch regulated onchain trading",
        excerpt: "The three companies launched the product together.",
        sourceUrl: "https://news.example/established-integration",
        capturedAt: "2026-07-12T12:00:00.000Z",
        contentHash: "8".repeat(64),
        match: "exact_handle",
      }],
    }, axes);

    const floors = projectScoreFloorsForPacket(packet, axes);
    expect(floors).toEqual({
      P1_team_and_identity: 14,
      P2_product_substance: 21,
      P3_token_conduct: 17,
      P4_backing_and_partners: 10,
      P5_traction_and_liveness: 12,
      P6_transparency_integrity: 11,
    });
    expect(Object.values(floors).reduce((total, score) => total + score, 0)).toBe(85);
    expect(Object.fromEntries(Object.entries(deriveProjectStrengthBands(packet, axes))
      .map(([axis, band]) => [axis, band.tier]))).toEqual({
      P1_team_and_identity: "exceptional",
      P2_product_substance: "exceptional",
      P3_token_conduct: "exceptional",
      P4_backing_and_partners: "solid",
      P5_traction_and_liveness: "exceptional",
      P6_transparency_integrity: "exceptional",
    });
  });

  it("keeps a Jupiter-like established exchange fully scoreable above the old 72 calibration", () => {
    const axes: AnalystAxis[] = Object.entries(getProfile(SubjectClass.PROJECT).axes)
      .map(([axis, weight]) => ({ axis, weight, role: SubjectClass.PROJECT }));
    const packet = buildScoringEvidencePacket({
      profile: {
        handle: "@JupiterExchange",
        display_name: "Jupiter",
        website: "https://jup.ag",
        days_since_post: 0,
        profile_collection_state: "resolved",
        profile_provider: "twitterapi",
        profile_captured_at: "2026-07-12T20:00:00.000Z",
      },
      team: [
        { name: "Meow", role: "Co-founder", sourceUrl: "https://jup.ag/team", provider: "team-page", artifact_verified: true },
        { name: "Siong", role: "Co-founder", sourceUrl: "https://jup.ag/team", provider: "team-page", artifact_verified: true },
      ],
      basicFacts: [
        { predicate: "legal_entity", value: "Block Raccoon S.A.", status: "verified", artifact_verified: true },
        { predicate: "official_identity", value: "Jupiter", status: "verified", artifact_verified: true },
        { predicate: "product", value: "Live production Solana swap exchange", status: "verified", artifact_verified: true },
        { predicate: "repository", value: "github.com/jup-ag", status: "verified", artifact_verified: true },
        { predicate: "governance", value: "JUP token-holder governance", status: "verified", artifact_verified: true },
        { predicate: "tokenomics", value: "Published JUP allocation and supply schedule", status: "verified", artifact_verified: true },
        { predicate: "vesting", value: "Published contributor unlock schedule", status: "verified", artifact_verified: true },
        { predicate: "audit", value: "Independent protocol security reviews", status: "verified", artifact_verified: true },
        { predicate: "investor", value: "Jump Crypto disclosed as an integration counterparty and backer", status: "verified", artifact_verified: true },
        { predicate: "traction", value: "$1B verified daily protocol trading volume", qualifier: "as of 2026-07-10", status: "verified", artifact_verified: true },
      ],
      projectToken: {
        verified: true,
        verification: "official_domain",
        name: "Jupiter",
        symbol: "JUP",
        coingeckoId: "jupiter-exchange-solana",
        rank: 90,
        address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
        chain: "solana",
        sourceUrl: "https://www.coingecko.com/en/coins/jupiter-exchange-solana",
        capturedAt: "2026-07-12T20:00:00.000Z",
        providers: ["coingecko", "dexscreener", "geckoterminal"],
        marketCapUsd: 662_000_000,
        volume24hUsd: 18_090_000,
        liquidityUsd: 5_100_000,
      },
      sourceArtifacts: [{
        kind: "press",
        provider: "google-news",
        title: "Securitize, Jump, Jupiter launch regulated onchain trading on Solana",
        excerpt: "Securitize, Jump Crypto, and Jupiter launched the integration together.",
        sourceUrl: "https://news.example/securitize-jump-jupiter",
        capturedAt: "2026-07-12T20:00:00.000Z",
        publishedAt: "2026-07-10T12:00:00.000Z",
        contentHash: "9".repeat(64),
        match: "exact_handle",
      }],
    }, axes);
    const preflight = inspectAnalystScoringPreflight(axes, packet);
    const bands = deriveProjectStrengthBands(packet, axes);
    const floors = Object.values(bands).reduce((total, band) => total + band.minScore, 0);

    expect(preflight).toMatchObject({ state: "ready", missingSubstantiveAxes: [] });
    expect(Object.fromEntries(Object.entries(bands).map(([axis, band]) => [axis, band.tier]))).toEqual({
      P1_team_and_identity: "exceptional",
      P2_product_substance: "exceptional",
      P3_token_conduct: "exceptional",
      P4_backing_and_partners: "solid",
      P5_traction_and_liveness: "exceptional",
      P6_transparency_integrity: "exceptional",
    });
    expect(floors).toBeGreaterThanOrEqual(85);
  });

  it("keeps a rich tokenless brand account scoreable instead of abstaining on every axis", () => {
    const axes: AnalystAxis[] = Object.entries(getProfile(SubjectClass.PROJECT).axes)
      .map(([axis, weight]) => ({ axis, weight, role: SubjectClass.PROJECT }));
    const tokenlessInput = {
      profile: {
        handle: "@custody_company",
        display_name: "Custody Company",
        website: "https://custody.example",
        days_since_post: 1,
        profile_collection_state: "resolved",
        profile_provider: "twitterapi",
        profile_captured_at: "2026-07-12T12:00:00.000Z",
      },
      team: [
        { name: "Chief Executive", role: "CEO", provider: "team-page", artifact_verified: true },
        { name: "Chief Technologist", role: "CTO", provider: "team-page", artifact_verified: true },
      ],
      basicFacts: [
        { predicate: "legal_entity", value: "Custody Company Inc.", status: "verified", artifact_verified: true },
        { predicate: "official_identity", value: "Custody Company", status: "verified", artifact_verified: true },
        { predicate: "product", value: "Live production custody platform", status: "verified", artifact_verified: true },
        { predicate: "repository", value: "github.com/example/custody", status: "verified", artifact_verified: true },
        { predicate: "governance", value: "Documented board and change-control governance", status: "verified", artifact_verified: true },
        { predicate: "treasury", value: "Quarterly treasury attestation reports", status: "verified", artifact_verified: true },
        { predicate: "audit", value: "Independent security audits published", status: "verified", artifact_verified: true },
        { predicate: "funding", value: "$100M Series C round", status: "verified", artifact_verified: true },
        { predicate: "investor", value: "Named venture backer disclosed", status: "verified", artifact_verified: true },
        { predicate: "traction", value: "$5B in platform assets under custody", qualifier: "as of 2026-07-10", status: "verified", artifact_verified: true },
      ],
    };
    const packet = buildScoringEvidencePacket(tokenlessInput, axes);
    const bands = deriveProjectStrengthBands(packet, axes);

    expect(bands.P3_token_conduct.tier).toBe("solid");
    expect(inspectAnalystScoringPreflight(axes, packet)).toMatchObject({
      state: "ready",
      missingSubstantiveAxes: [],
    });

    // One conduct-disclosure category alone stays conservative.
    const governanceOnly = buildScoringEvidencePacket({
      basicFacts: [{ predicate: "governance", value: "Documented governance process", status: "verified", artifact_verified: true }],
    }, axes);
    expect(deriveProjectStrengthBands(governanceOnly, axes).P3_token_conduct.tier).toBe("emerging");

    // A discovered token that failed official verification still fails closed.
    const unverifiedTokenPacket = buildScoringEvidencePacket({
      ...tokenlessInput,
      projectToken: {
        verified: false,
        name: "Custody Token",
        symbol: "CST",
        capturedAt: "2026-07-12T12:00:00.000Z",
      },
    }, axes);
    expect(deriveProjectStrengthBands(unverifiedTokenPacket, axes).P3_token_conduct.tier).toBe("none");
    expect(inspectAnalystScoringPreflight(axes, unverifiedTokenPacket)).toMatchObject({
      state: "insufficient_evidence",
      missingSubstantiveAxes: ["P3_token_conduct"],
    });
  });

  it("counts syndicated relationship coverage as one story instead of exceptional corroboration", () => {
    const axes: AnalystAxis[] = [{
      axis: "P4_backing_and_partners",
      weight: 14,
      role: SubjectClass.PROJECT,
    }];
    const syndicated = [
      {
        kind: "press",
        provider: "google-news",
        title: "Jupiter partners with Counterparty on regulated trading",
        excerpt: "Jupiter and Counterparty launched a regulated trading integration.",
        sourceUrl: "https://wire-a.example/jupiter-counterparty",
        capturedAt: "2026-07-12T12:00:00.000Z",
        publishedAt: "2026-07-10T12:00:00.000Z",
        contentHash: "a".repeat(64),
        match: "exact_handle",
      },
      {
        kind: "press",
        provider: "google-news",
        title: "Jupiter partners with Counterparty on regulated trading | Syndicated News",
        excerpt: "Jupiter and Counterparty launched a regulated trading integration.",
        sourceUrl: "https://wire-b.example/copied-jupiter-counterparty",
        capturedAt: "2026-07-12T12:00:00.000Z",
        publishedAt: "2026-07-10T12:00:00.000Z",
        contentHash: "b".repeat(64),
        match: "exact_handle",
      },
    ];
    const syndicatedPacket = buildScoringEvidencePacket({ sourceArtifacts: syndicated }, axes);
    const independentlyCorroboratedPacket = buildScoringEvidencePacket({
      sourceArtifacts: [
        ...syndicated,
        {
          ...syndicated[0],
          title: "Counterparty confirms its production integration with Jupiter",
          sourceUrl: "https://counterparty.example/news/jupiter-integration",
          contentHash: "c".repeat(64),
        },
      ],
    }, axes);

    expect(deriveProjectStrengthBands(syndicatedPacket, axes).P4_backing_and_partners.tier).toBe("solid");
    expect(deriveProjectStrengthBands(independentlyCorroboratedPacket, axes).P4_backing_and_partners.tier).toBe("exceptional");
  });

  it("lets unverified press widen the allowed ceiling but never force a score floor", () => {
    const axes: AnalystAxis[] = [{
      axis: "P4_backing_and_partners",
      weight: 14,
      role: SubjectClass.PROJECT,
    }];
    const pressOnly = buildScoringEvidencePacket({
      sourceArtifacts: [{
        kind: "press",
        provider: "google-news",
        title: "Project partners with Counterparty on regulated trading",
        excerpt: "The companies launched the integration together.",
        sourceUrl: "https://wire.example/project-counterparty",
        capturedAt: "2026-07-12T12:00:00.000Z",
        publishedAt: "2026-07-10T12:00:00.000Z",
        contentHash: "d".repeat(64),
        match: "exact_handle",
      }],
    }, axes);
    const verifiedBacking = buildScoringEvidencePacket({
      basicFacts: [{
        predicate: "investor",
        value: "Counterparty disclosed as a strategic backer",
        status: "verified",
        artifact_verified: true,
      }],
    }, axes);

    const pressBand = deriveProjectStrengthBands(pressOnly, axes).P4_backing_and_partners;
    // Headlines that were never passage-verified may justify a higher ceiling
    // for the analyst's judgment, but must not manufacture a minimum score.
    expect(pressBand.tier).toBe("solid");
    expect(pressBand.minScore).toBe(0);
    expect(pressBand.maxScore).toBeGreaterThan(0);
    expect(pressBand.reasons).toContain("unverified press widens the ceiling only, never the floor");

    const verifiedBand = deriveProjectStrengthBands(verifiedBacking, axes).P4_backing_and_partners;
    // A verified backing record is exactly what a floor may derive from.
    expect(verifiedBand.tier).toBe("solid");
    expect(verifiedBand.minScore).toBeGreaterThan(0);
  });

  it("never lets fresh press headlines force a traction or liveness floor", () => {
    const axes: AnalystAxis[] = [{
      axis: "P5_traction_and_liveness",
      weight: 14,
      role: SubjectClass.PROJECT,
    }];
    const freshPress = {
      kind: "press",
      provider: "google-news",
      title: "Project launches a production exchange upgrade",
      excerpt: "The project shipped its latest platform release.",
      sourceUrl: "https://wire.example/project-release",
      capturedAt: "2026-07-12T12:00:00.000Z",
      publishedAt: "2026-07-10T12:00:00.000Z",
      contentHash: "e".repeat(64),
      match: "exact_handle",
    } as const;
    const pressOnly = buildScoringEvidencePacket({ sourceArtifacts: [freshPress] }, axes);
    const verifiedTraction = buildScoringEvidencePacket({
      sourceArtifacts: [freshPress],
      basicFacts: [{
        predicate: "traction",
        value: "$25M verified daily protocol volume",
        qualifier: "as of 2026-07-10",
        status: "verified",
        artifact_verified: true,
      }],
    }, axes);

    const pressOnlyBand = deriveProjectStrengthBands(pressOnly, axes).P5_traction_and_liveness;
    expect(pressOnlyBand.tier).toBe("emerging");
    expect(pressOnlyBand.minScore).toBe(0);
    expect(pressOnlyBand.maxScore).toBeGreaterThan(0);
    expect(pressOnlyBand.reasons).toContain("unverified press widens the ceiling only, never the floor");

    const tractionBand = deriveProjectStrengthBands(verifiedTraction, axes).P5_traction_and_liveness;
    expect(tractionBand.tier).toBe("solid");
    expect(tractionBand.minScore).toBeLessThan(Math.ceil(axes[0].weight * 0.7));
    expect(tractionBand.minScore).toBe(Math.ceil(axes[0].weight * 0.4));
  });

  it("keeps staff, generic posts, and unrelated beta mentions from inflating project strength", () => {
    const axes: AnalystAxis[] = Object.entries(getProfile(SubjectClass.PROJECT).axes)
      .map(([axis, weight]) => ({ axis, weight, role: SubjectClass.PROJECT }));
    const packet = buildScoringEvidencePacket({
      profile: {
        handle: "@project",
        display_name: "Project",
        website: "https://project.example",
        days_since_post: 2,
        profile_collection_state: "resolved",
        profile_provider: "twitterapi",
        profile_captured_at: "2026-07-12T12:00:00.000Z",
      },
      team: [
        { name: "Community Lead", role: "Community manager", provider: "team-page", artifact_verified: true },
        { name: "Support Lead", role: "Support specialist", provider: "team-page", artifact_verified: true },
      ],
      basicFacts: [
        { predicate: "repository", value: "github.com/project/protocol", status: "verified", artifact_verified: true },
        { predicate: "product", value: "Live production exchange", status: "verified", artifact_verified: true },
        { predicate: "audit", value: "Independent protocol audit", status: "verified", artifact_verified: true },
      ],
      recentActivity: [
        { provider: "twitterapi", text: "gm everyone, have a great weekend" },
        { provider: "twitterapi", text: "Launched a beta community ambassador program while the production exchange remains live." },
      ],
    }, axes);
    const bands = deriveProjectStrengthBands(packet, axes);

    expect(bands.P1_team_and_identity.tier).toBe("emerging");
    expect(bands.P2_product_substance.tier).toBe("exceptional");
    expect(bands.P2_product_substance.reasons).not.toContain("explicit early-stage product marker");
  });

  it("requires token disclosure, not an unrelated audit alone, for exceptional token conduct", () => {
    const axes: AnalystAxis[] = [{ axis: "P3_token_conduct", weight: 20, role: SubjectClass.PROJECT }];
    const token = {
      verified: true as const,
      verification: "official_domain" as const,
      name: "Project Token",
      symbol: "PRJ",
      coingeckoId: "project-token",
      rank: 50,
      address: "0x0000000000000000000000000000000000000123",
      chain: "ethereum",
      sourceUrl: "https://project.example/token",
      capturedAt: "2026-07-12T12:00:00.000Z",
      providers: ["coingecko" as const, "dexscreener" as const],
      marketCapUsd: 500_000_000,
      volume24hUsd: 25_000_000,
      liquidityUsd: 10_000_000,
    };
    const auditOnly = buildScoringEvidencePacket({
      projectToken: token,
      basicFacts: [{ predicate: "audit", value: "Independent protocol audit", status: "verified", artifact_verified: true }],
    }, axes);
    const governanceOnly = buildScoringEvidencePacket({
      projectToken: token,
      basicFacts: [{ predicate: "governance", value: "Token-holder governance", status: "verified", artifact_verified: true }],
    }, axes);
    const disclosedWithoutSecurity = buildScoringEvidencePacket({
      projectToken: token,
      basicFacts: [
        { predicate: "governance", value: "Token-holder governance", status: "verified", artifact_verified: true },
        { predicate: "tokenomics", value: "Published token allocation and supply schedule", status: "verified", artifact_verified: true },
      ],
    }, axes);
    const disclosedAndAudited = buildScoringEvidencePacket({
      projectToken: token,
      basicFacts: [
        { predicate: "audit", value: "Independent protocol audit", status: "verified", artifact_verified: true },
        { predicate: "tokenomics", value: "Published token allocation and supply schedule", status: "verified", artifact_verified: true },
      ],
    }, axes);

    expect(deriveProjectStrengthBands(auditOnly, axes).P3_token_conduct.tier).toBe("solid");
    expect(deriveProjectStrengthBands(governanceOnly, axes).P3_token_conduct.tier).toBe("solid");
    expect(deriveProjectStrengthBands(disclosedWithoutSecurity, axes).P3_token_conduct.tier).toBe("solid");
    expect(deriveProjectStrengthBands(disclosedAndAudited, axes).P3_token_conduct.tier).toBe("exceptional");
  });

  it("distinguishes protocol volume from token trading and freezes profile recency for P5", () => {
    const axes: AnalystAxis[] = [{ axis: "P5_traction_and_liveness", weight: 14, role: SubjectClass.PROJECT }];
    const base = {
      profile: {
        handle: "@exchange",
        display_name: "Exchange",
        days_since_post: 1,
        profile_collection_state: "resolved",
        profile_provider: "twitterapi",
        profile_captured_at: "2026-07-12T12:00:00.000Z",
      },
      projectToken: {
        verified: true as const,
        verification: "official_x" as const,
        name: "Exchange Token",
        symbol: "EX",
        coingeckoId: "exchange-token",
        rank: 40,
        address: "0x0000000000000000000000000000000000000456",
        chain: "ethereum",
        sourceUrl: "https://exchange.example/token",
        capturedAt: "2026-07-12T12:00:00.000Z",
        providers: ["coingecko" as const, "dexscreener" as const, "geckoterminal" as const],
        marketCapUsd: 900_000_000,
        volume24hUsd: 30_000_000,
        liquidityUsd: 20_000_000,
      },
    };
    const protocolPacket = buildScoringEvidencePacket({
      ...base,
      basicFacts: [{ predicate: "traction", value: "$1B daily protocol trading volume", qualifier: "as of 2026-07-10", status: "verified", artifact_verified: true }],
    }, axes);
    const undatedProtocolPacket = buildScoringEvidencePacket({
      ...base,
      basicFacts: [{ predicate: "traction", value: "$1B daily protocol trading volume", status: "verified", artifact_verified: true }],
    }, axes);
    const staleDatedProtocolPacket = buildScoringEvidencePacket({
      ...base,
      basicFacts: [{ predicate: "traction", value: "$1B daily protocol trading volume", qualifier: "as of 2025-01-10", status: "verified", artifact_verified: true }],
    }, axes);
    const tokenOnlyPacket = buildScoringEvidencePacket({
      ...base,
      basicFacts: [{ predicate: "traction", value: "$30M token trading volume", status: "verified", artifact_verified: true }],
    }, axes);
    const stalePacket = buildScoringEvidencePacket({
      ...base,
      profile: { ...base.profile, days_since_post: 21 },
      recentActivity: [{ provider: "twitterapi", text: "Generic undated post" }],
    }, axes);
    const recentFallbackPacket = buildScoringEvidencePacket({
      projectToken: base.projectToken,
      recentActivity: [{ provider: "twitterapi", text: "Released the latest production router upgrade." }],
    }, axes);
    const protocolWithoutXPacket = buildScoringEvidencePacket({
      projectToken: base.projectToken,
      basicFacts: [{ predicate: "traction", value: "$1B daily protocol trading volume", status: "verified", artifact_verified: true }],
    }, axes);
    const currentProtocolWithoutXPacket = buildScoringEvidencePacket({
      projectToken: base.projectToken,
      basicFacts: [{ predicate: "traction", value: "$1B daily protocol trading volume", status: "verified", artifact_verified: true }],
      sourceArtifacts: [{
        kind: "press",
        provider: "google-news",
        title: "Exchange releases production routing upgrade",
        excerpt: "The exchange shipped its current production routing release.",
        sourceUrl: "https://news.example/current-exchange-release",
        capturedAt: "2026-07-12T12:00:00.000Z",
        publishedAt: "2026-07-10T12:00:00.000Z",
        contentHash: "7".repeat(64),
        match: "exact_handle",
      }],
    }, axes);
    const datedCurrentProtocolWithoutXPacket = buildScoringEvidencePacket({
      projectToken: base.projectToken,
      basicFacts: [{ predicate: "traction", value: "$1B daily protocol trading volume", qualifier: "as of 2026-07-10", status: "verified", artifact_verified: true }],
      sourceArtifacts: [{
        kind: "press",
        provider: "google-news",
        title: "Exchange releases production routing upgrade",
        excerpt: "The exchange shipped its current production routing release.",
        sourceUrl: "https://news.example/current-exchange-release",
        capturedAt: "2026-07-12T12:00:00.000Z",
        publishedAt: "2026-07-10T12:00:00.000Z",
        contentHash: "7".repeat(64),
        match: "exact_handle",
      }],
    }, axes);
    const untrustedCadencePacket = buildScoringEvidencePacket({
      profile: {
        handle: "@exchange",
        display_name: "Exchange",
        days_since_post: 1,
        profile_collection_state: "resolved",
      },
      projectToken: base.projectToken,
    }, axes);

    expect(deriveProjectStrengthBands(protocolPacket, axes).P5_traction_and_liveness.tier).toBe("exceptional");
    expect(deriveProjectStrengthBands(undatedProtocolPacket, axes).P5_traction_and_liveness.tier).toBe("solid");
    expect(deriveProjectStrengthBands(staleDatedProtocolPacket, axes).P5_traction_and_liveness.tier).toBe("solid");
    expect(deriveProjectStrengthBands(tokenOnlyPacket, axes).P5_traction_and_liveness.tier).toBe("solid");
    expect(deriveProjectStrengthBands(stalePacket, axes).P5_traction_and_liveness.tier).toBe("emerging");
    expect(deriveProjectStrengthBands(recentFallbackPacket, axes).P5_traction_and_liveness.tier).toBe("emerging");
    expect(deriveProjectStrengthBands(protocolWithoutXPacket, axes).P5_traction_and_liveness.tier).toBe("emerging");
    expect(deriveProjectStrengthBands(currentProtocolWithoutXPacket, axes).P5_traction_and_liveness.tier).toBe("solid");
    expect(deriveProjectStrengthBands(datedCurrentProtocolWithoutXPacket, axes).P5_traction_and_liveness.tier).toBe("exceptional");
    expect(deriveProjectStrengthBands(untrustedCadencePacket, axes).P5_traction_and_liveness.tier).toBe("emerging");
    expect(extractScoringEvidenceCatalog(protocolPacket, axes)
      .find((artifact) => artifact.section === "profile")?.eligibleAxes)
      .toContain("P5_traction_and_liveness");
    expect(extractScoringEvidenceCatalog(untrustedCadencePacket, axes)
      .some((artifact) => artifact.section === "profile" && artifact.eligibleAxes.includes("P5_traction_and_liveness")))
      .toBe(false);
  });

  it("uses an adverse band for verified harm and never turns missing evidence into zero", () => {
    const axes: AnalystAxis[] = [{ axis: "P3_token_conduct", weight: 20, role: SubjectClass.PROJECT }];
    const harmfulPacket = buildScoringEvidencePacket({
      findings: [{
        finding_type: "TokenCollapse",
        claim: "The canonical token suffered a verified collapse.",
        source_url: "https://investigator.example/token-collapse",
        verification_status: "Verified",
        polarity: -1,
        evidence_origin: "deterministic",
        artifact_verified: true,
      }],
    }, axes);
    const emptyPacket = buildScoringEvidencePacket({}, axes);
    const harmfulCatalog = extractScoringEvidenceCatalog(harmfulPacket, axes);
    const harmfulBand = deriveProjectStrengthBands(harmfulPacket, axes);
    const finding = harmfulCatalog.find((artifact) => artifact.section === "findings")!;

    expect(harmfulBand.P3_token_conduct).toMatchObject({ tier: "adverse", minScore: 0, maxScore: 7 });
    expect(inspectAnalystScoringPreflight(axes, harmfulPacket).state).toBe("ready");
    expect(validateAnalystVerdict({
      axes: [validAxis("P3_token_conduct", 3, finding.artifactId)],
      headline: "Verified token collapse governs the assessment.",
      identity_note: "Identity is not material to this adverse token finding.",
    }, axes, harmfulCatalog, undefined, { projectScoreBands: harmfulBand })).not.toBeNull();

    expect(deriveProjectStrengthBands(emptyPacket, axes).P3_token_conduct).toEqual({
      tier: "none",
      minScore: 0,
      maxScore: 0,
      reasons: [],
      anchorArtifactIds: [],
    });
    expect(inspectAnalystScoringPreflight(axes, emptyPacket)).toMatchObject({
      state: "insufficient_evidence",
      missingSubstantiveAxes: ["P3_token_conduct"],
    });
  });

  it("requires verified score-limiting evidence below a project band and enforces its ceiling", () => {
    const projectAxes: AnalystAxis[] = [
      { axis: "P1_team_and_identity", weight: 16, role: SubjectClass.PROJECT },
      { axis: "P4_backing_and_partners", weight: 14, role: SubjectClass.PROJECT },
    ];
    const p1Support = `art_v1_${"a".repeat(64)}`;
    const p4Support = `art_v1_${"b".repeat(64)}`;
    const positiveP4Context = `art_v1_${"c".repeat(64)}`;
    const adverseP4Finding = `art_v1_${"d".repeat(64)}`;
    const evidence = [
      axisArtifact(p1Support, [projectAxes[0].axis]),
      axisArtifact(p4Support, [projectAxes[1].axis]),
      axisArtifact(positiveP4Context, [projectAxes[1].axis], "verified"),
      axisArtifact(adverseP4Finding, [projectAxes[1].axis], "verified", [projectAxes[1].axis]),
    ];
    const payload = (p1Score: number, p4Score: number, p4Counter: string[] = []) => ({
      axes: [
        validAxis(projectAxes[0].axis, p1Score, p1Support),
        { ...validAxis(projectAxes[1].axis, p4Score, p4Support), counterEvidenceRefs: p4Counter },
      ],
      headline: "Evidence-backed project result",
      identity_note: "Named team is verified",
    });
    const solidBands = {
      P1_team_and_identity: {
        tier: "solid" as const,
        minScore: 12,
        maxScore: 13,
        reasons: ["solid identity anchors"],
        anchorArtifactIds: [p1Support],
      },
      P4_backing_and_partners: {
        tier: "solid" as const,
        minScore: 10,
        maxScore: 11,
        reasons: ["solid relationship anchors"],
        anchorArtifactIds: [p4Support],
      },
    };

    const rejection = vi.fn();
    expect(validateAnalystVerdict(payload(11, 9), projectAxes, evidence, rejection, {
      projectScoreBands: solidBands,
    })).toBeNull();
    expect(rejection).toHaveBeenLastCalledWith(
      "project-scores-outside-evidence-strength-band:P1_team_and_identity,P4_backing_and_partners",
    );
    expect(validateAnalystVerdict(payload(12, 10), projectAxes, evidence, undefined, {
      projectScoreBands: solidBands,
    })).not.toBeNull();
    const positiveCounterRejection = vi.fn();
    expect(validateAnalystVerdict(payload(12, 10, [positiveP4Context]), projectAxes, evidence, positiveCounterRejection, {
      projectScoreBands: solidBands,
    })).toBeNull();
    expect(positiveCounterRejection).toHaveBeenLastCalledWith(
      "project-counter-reference-not-score-limiting:P4_backing_and_partners",
    );
    expect(validateAnalystVerdict(payload(12, 9, [positiveP4Context]), projectAxes, evidence, undefined, {
      projectScoreBands: solidBands,
    })).toBeNull();
    expect(validateAnalystVerdict(payload(12, 9, [adverseP4Finding]), projectAxes, evidence, undefined, {
      projectScoreBands: solidBands,
    })).not.toBeNull();
    expect(validateAnalystVerdict(payload(14, 11), projectAxes, evidence, undefined, {
      projectScoreBands: solidBands,
    })).toBeNull();
    const exceptionalBands = {
      P1_team_and_identity: { ...solidBands.P1_team_and_identity, tier: "exceptional" as const, minScore: 14, maxScore: 16 },
      P4_backing_and_partners: { ...solidBands.P4_backing_and_partners, tier: "solid" as const, minScore: 10, maxScore: 11 },
    };
    expect(validateAnalystVerdict(payload(12, 10), projectAxes, evidence, undefined, {
      projectScoreBands: exceptionalBands,
    })).toBeNull();
    expect(validateAnalystVerdict(payload(14, 11), projectAxes, evidence, undefined, {
      projectScoreBands: exceptionalBands,
    })).not.toBeNull();
  });

  it("accepts exactly one finite, in-range score per requested axis", () => {
    const result = validateAnalystVerdict({
      axes: [
        { ...validAxis("F2_track_record", 20, F2_REF), rationale: "documented history", counterEvidenceRefs: [F2_COUNTER_REF] },
        { ...validAxis("F1_identity_verifiability", 10, F1_REF), rationale: "named identity" },
      ],
      headline: "Complete result",
      identity_note: "Identity resolved",
    }, catalog, validationCatalog);

    expect(result?.axes.map((axis) => axis.axis)).toEqual(catalog.map((axis) => axis.axis));
    expect(result?.axes.map((axis) => axis.score)).toEqual([10, 20]);
  });

  it("normalizes a strict axis-keyed verdict and short citation aliases in canonical order", () => {
    const result = validateAnalystVerdict({
      axes: {
        F2_track_record: {
          score: 20,
          rationale: "documented history",
          primaryEvidenceRef: "e002",
          additionalEvidenceRefs: [],
          coverageRefs: ["e004"],
          counterEvidenceRefs: ["e003"],
          gaps: ["One track-record provider was unavailable."],
        },
        F1_identity_verifiability: {
          score: 10,
          rationale: "named identity",
          primaryEvidenceRef: "E001",
          additionalEvidenceRefs: [],
          counterEvidenceRefs: [],
          gaps: [],
        },
      },
      headline: "Complete result",
      identity_note: "Identity resolved",
    }, catalog, validationCatalog);

    expect(result?.axes).toEqual([
      expect.objectContaining({ axis: "F1_identity_verifiability", evidenceRefs: [F1_REF] }),
      expect.objectContaining({
        axis: "F2_track_record",
        evidenceRefs: [F2_REF, F2_UNAVAILABLE_REF],
        counterEvidenceRefs: [F2_COUNTER_REF],
      }),
    ]);
  });

  it.each([
    {
      label: "missing keyed axis",
      axes: {
        F1_identity_verifiability: {
          score: 10,
          rationale: "named identity",
          primaryEvidenceRef: "e001",
          additionalEvidenceRefs: [],
          counterEvidenceRefs: [],
          gaps: [],
        },
      },
      reason: "axis-key-set",
    },
    {
      label: "extra keyed axis",
      axes: {
        F1_identity_verifiability: {},
        F2_track_record: {},
        MADE_UP: {},
      },
      reason: "axis-key-set",
    },
  ])("rejects a $label without filling or dropping an axis", ({ axes, reason }) => {
    const rejection = vi.fn();
    expect(validateAnalystVerdict({
      axes,
      headline: "Invalid result",
      identity_note: "Identity resolved",
    }, catalog, validationCatalog, rejection)).toBeNull();
    expect(rejection).toHaveBeenLastCalledWith(reason);
  });

  it("requires the keyed coverage field exactly when eligible gap artifacts exist", () => {
    const rejection = vi.fn();
    expect(validateAnalystVerdict({
      axes: {
        F1_identity_verifiability: {
          score: 10,
          rationale: "named identity",
          primaryEvidenceRef: "e001",
          additionalEvidenceRefs: [],
          counterEvidenceRefs: [],
          gaps: [],
        },
        F2_track_record: {
          score: 20,
          rationale: "documented history",
          primaryEvidenceRef: "e002",
          additionalEvidenceRefs: [],
          counterEvidenceRefs: [],
          gaps: [],
        },
      },
      headline: "Invalid result",
      identity_note: "Identity resolved",
    }, catalog, validationCatalog, rejection)).toBeNull();
    expect(rejection).toHaveBeenLastCalledWith("coverage-field-shape:F2_track_record");
  });

  it("rejects undeclared fields in a keyed axis row", () => {
    const rejection = vi.fn();
    expect(validateAnalystVerdict({
      axes: {
        F1_identity_verifiability: {
          score: 10,
          rationale: "named identity",
          primaryEvidenceRef: "e001",
          additionalEvidenceRefs: [],
          counterEvidenceRefs: [],
          gaps: [],
          ignoredEvidenceRefs: ["e002"],
        },
        F2_track_record: {
          score: 20,
          rationale: "documented history",
          primaryEvidenceRef: "e002",
          additionalEvidenceRefs: [],
          coverageRefs: [],
          counterEvidenceRefs: [],
          gaps: [],
        },
      },
      headline: "Invalid result",
      identity_note: "Identity resolved",
    }, catalog, validationCatalog, rejection)).toBeNull();
    expect(rejection).toHaveBeenLastCalledWith("axis-row-extra-field:F1_identity_verifiability");
  });

  it("rejects undeclared top-level fields", () => {
    const rejection = vi.fn();
    expect(validateAnalystVerdict({
      axes: [
        validAxis("F1_identity_verifiability", 10, F1_REF),
        validAxis("F2_track_record", 20, F2_REF),
      ],
      headline: "Invalid result",
      identity_note: "Identity resolved",
      ignored: true,
    }, catalog, validationCatalog, rejection)).toBeNull();
    expect(rejection).toHaveBeenLastCalledWith("root-extra-field");
  });

  it("rejects an unresolved-identity narrative when the frozen project packet contains a grounded named team", () => {
    const projectAxes: AnalystAxis[] = [
      { axis: "P1_team_and_identity", weight: 16, role: "PROJECT" },
    ];
    const frozen = extractScoringEvidenceCatalog(buildScoringEvidencePacket({
      team: [{
        name: "Named Co-Founder",
        handle: "@namedfounder",
        role: "co-founder",
        source: "official project documentation",
        sourceUrl: "https://docs.example.com/team/founders",
        provider: "team-page",
        evidence_origin: "deterministic",
        artifact_verified: true,
      }],
    }, projectAxes));
    const teamArtifact = frozen.find((artifact) => artifact.section === "team")!;
    expect(teamArtifact.sourceUrl).toBe("https://docs.example.com/team/founders");
    const rejection = vi.fn();

    expect(validateAnalystVerdict({
      axes: [validAxis("P1_team_and_identity", 13, teamArtifact.artifactId)],
      headline: "The product is active, but real-world team identity remains unresolved.",
      identity_note: "The public team is named in official documentation.",
    }, projectAxes, frozen, rejection)).toBeNull();
    expect(rejection).toHaveBeenLastCalledWith("grounded-team-described-as-unresolved");

    rejection.mockClear();
    expect(validateAnalystVerdict({
      axes: [{
        ...validAxis("P1_team_and_identity", 13, teamArtifact.artifactId),
        rationale: "The product is active, but no named leadership is publicly surfaced.",
        gaps: ["Named founders or executives are not surfaced in the evidence packet."],
      }],
      headline: "A named public team operates the active project.",
      identity_note: "Identity is resolved through the named co-founder in official project documentation.",
    }, projectAxes, frozen, rejection)).toBeNull();
    expect(rejection).toHaveBeenLastCalledWith("grounded-team-described-as-unresolved");

    rejection.mockClear();
    expect(validateAnalystVerdict({
      axes: [validAxis("P1_team_and_identity", 13, teamArtifact.artifactId)],
      headline: "Strong execution is held back by absent named leadership disclosure.",
      identity_note: "Identity is resolved through the named co-founder in official project documentation.",
    }, projectAxes, frozen, rejection)).toBeNull();
    expect(rejection).toHaveBeenLastCalledWith("grounded-team-described-as-unresolved");

    rejection.mockClear();
    expect(validateAnalystVerdict({
      axes: [{
        ...validAxis("P1_team_and_identity", 13, teamArtifact.artifactId),
        rationale: "Named founders or executives are not enumerated in the collected evidence.",
        gaps: ["The score is tempered by the absence of named founders in the evidence packet."],
      }],
      headline: "A named public team operates the active project.",
      identity_note: "Identity is resolved through Meow and Siong in first-party sources.",
    }, projectAxes, frozen, rejection)).toBeNull();
    expect(rejection).toHaveBeenLastCalledWith("grounded-team-described-as-unresolved");

    rejection.mockClear();
    expect(validateAnalystVerdict({
      axes: [{
        ...validAxis("P1_team_and_identity", 13, teamArtifact.artifactId),
        gaps: ["Named founder or CEO with verifiable public profile not confirmed in evidence packet"],
      }],
      headline: "A named public team operates the active project.",
      identity_note: "Identity is resolved through Meow and Siong in first-party sources.",
    }, projectAxes, frozen, rejection)).toBeNull();
    expect(rejection).toHaveBeenLastCalledWith("grounded-team-described-as-unresolved");

    rejection.mockClear();
    expect(validateAnalystVerdict({
      axes: [{
        ...validAxis("P1_team_and_identity", 13, teamArtifact.artifactId),
        gaps: ["Named founders or CEO/CTO identities are not surfaced in the structured team array; only 2 generic team identities confirmed"],
      }],
      headline: "A named public team operates the active project.",
      identity_note: "Identity is resolved through Meow and Siong in first-party sources.",
    }, projectAxes, frozen, rejection)).toBeNull();
    expect(rejection).toHaveBeenLastCalledWith("grounded-team-described-as-unresolved");

    expect(validateAnalystVerdict({
      axes: [validAxis("P1_team_and_identity", 13, teamArtifact.artifactId)],
      headline: "Identity is resolved through a named public team, while tokenomics remain unknown.",
      identity_note: "Identity is resolved through the named co-founder in official project documentation.",
    }, projectAxes, frozen)).not.toBeNull();
  });

  it("accepts exonerating and cross-axis team phrasing when the named team is grounded", () => {
    const projectAxes: AnalystAxis[] = [
      { axis: "P1_team_and_identity", weight: 16, role: "PROJECT" },
      { axis: "P6_transparency_integrity", weight: 13, role: "PROJECT" },
    ];
    const frozen = extractScoringEvidenceCatalog(buildScoringEvidencePacket({
      team: [{
        name: "Named Co-Founder",
        handle: "@namedfounder",
        role: "co-founder",
        source: "official project documentation",
        sourceUrl: "https://docs.example.com/team/founders",
        provider: "team-page",
        evidence_origin: "deterministic",
        artifact_verified: true,
      }],
      basicFacts: [{
        predicate: "legal_entity",
        value: "Example Labs S.A.",
        status: "verified",
        artifact_verified: true,
      }],
    }, projectAxes));
    const teamArtifact = frozen.find((artifact) => artifact.section === "team")!;
    const legalArtifact = frozen.find((artifact) => artifact.operation === "basicFacts:legal_entity")!;
    const rejection = vi.fn();

    expect(validateAnalystVerdict({
      axes: [
        {
          ...validAxis("P1_team_and_identity", 13, teamArtifact.artifactId),
          rationale: "The team is publicly named with no anonymous founders and no undisclosed leadership; this is not an anonymous team and there are no unnamed operators.",
          gaps: [
            "LinkedIn profiles for two executives could not be identified.",
            "The staff directory of executives was not enumerated by the provider.",
          ],
        },
        {
          ...validAxis("P6_transparency_integrity", 8, legalArtifact.artifactId),
          rationale: "The treasury multisig operators are not disclosed in the docs, though the legal entity is verified.",
          gaps: ["No litigation involving the founders was found in public records."],
        },
      ],
      headline: "No concerns about the team were identified for this named-team project.",
      identity_note: "Identity is resolved through the named co-founder; there are no anonymous founders behind the project.",
    }, projectAxes, frozen, rejection)).not.toBeNull();
    expect(rejection).not.toHaveBeenCalled();

    expect(validateAnalystVerdict({
      axes: [
        {
          ...validAxis("P1_team_and_identity", 13, teamArtifact.artifactId),
          rationale: "The founders remain anonymous despite the collected team records.",
        },
        validAxis("P6_transparency_integrity", 8, legalArtifact.artifactId),
      ],
      headline: "A named public team operates the project.",
      identity_note: "Identity is resolved through the named co-founder.",
    }, projectAxes, frozen, rejection)).toBeNull();
    expect(rejection).toHaveBeenLastCalledWith("grounded-team-described-as-unresolved");
  });

  it("keeps social affiliations, empty news, and missing personal GitHub out of founder track record", () => {
    const founderAxes: AnalystAxis[] = Object.entries(getProfile(SubjectClass.FOUNDER).axes)
      .map(([axis, weight]) => ({ axis, weight, role: SubjectClass.FOUNDER }));
    const frozen = extractScoringEvidenceCatalog(buildScoringEvidencePacket({
      checkOutcomes: [
        {
          checkId: "affiliations-associates",
          status: "confirmed",
          note: "4 of 6 claimed relationships were observed in the X follow graph",
          provider: "twitterapi.io",
        },
        {
          checkId: "code-footprint-github",
          status: "unavailable",
          note: "No personal GitHub account was resolved",
          provider: "github",
        },
        {
          checkId: "news-press",
          status: "checked-empty",
          note: "The exact-name RSS query returned no matching article",
          provider: "google-news",
        },
      ],
      basicFacts: [{
        predicate: "founder",
        value: "Aave Protocol",
        status: "verified",
        artifact_verified: true,
        sources: [{
          url: "https://aave.com/about",
          excerpt: "Stani Kulechov founded the Aave Protocol.",
          provider: "public-web",
          artifactVerified: true,
        }],
      }],
    }, founderAxes));

    const affiliation = frozen.find((artifact) => artifact.operation === "checkOutcomes:affiliations-associates")!;
    const github = frozen.find((artifact) => artifact.operation === "checkOutcomes:code-footprint-github")!;
    const news = frozen.find((artifact) => artifact.operation === "checkOutcomes:news-press")!;
    const founder = frozen.find((artifact) => artifact.operation === "basicFacts:founder")!;

    expect(affiliation.eligibleAxes).toEqual(["F6_network_quality"]);
    expect(github.eligibleAxes).not.toContain("F2_track_record");
    expect(news.eligibleAxes).not.toContain("F2_track_record");
    expect(news.eligibleAxes).not.toContain("F3_repeat_backing");
    expect(founder.verification).toBe("verified");
    expect(founder.eligibleAxes).toContain("F2_track_record");
  });

  it("rejects a social-only or claimed-role narrative when frozen facts verify the founder", () => {
    const founderAxes: AnalystAxis[] = [
      { axis: "F1_identity_verifiability", weight: 12, role: "FOUNDER" },
      { axis: "F2_track_record", weight: 28, role: "FOUNDER" },
    ];
    const frozen = extractScoringEvidenceCatalog(buildScoringEvidencePacket({
      basicFacts: [
        {
          predicate: "current_role",
          value: "Founder and CEO, Aave Labs",
          status: "verified",
          artifact_verified: true,
          sources: [{
            url: "https://investor.mastercard.com/aave-agent-pay",
            excerpt: "Stani Kulechov, founder and CEO of Aave Labs, commented on the launch.",
            provider: "public-web",
            artifactVerified: true,
          }],
        },
        {
          predicate: "founder",
          value: "Aave Protocol",
          status: "verified",
          artifact_verified: true,
          sources: [{
            url: "https://aave.com/about",
            excerpt: "Stani Kulechov founded the Aave Protocol after launching ETHLend.",
            provider: "public-web",
            artifactVerified: true,
          }],
        },
      ],
    }, founderAxes));
    const role = frozen.find((artifact) => artifact.operation === "basicFacts:current_role")!;
    const founder = frozen.find((artifact) => artifact.operation === "basicFacts:founder")!;
    const rejection = vi.fn();
    const badParagraph = "The subject presents as Founder & CEO of Aave. The subject's track record is inferred from the high-profile claimed role and follower base rather than independently verified artifacts in this evidence packet.";

    expect(validateAnalystVerdict({
      axes: [
        validAxis("F1_identity_verifiability", 10, role.artifactId),
        {
          ...validAxis("F2_track_record", 22, founder.artifactId),
          rationale: badParagraph,
        },
      ],
      headline: "Stani is publicly associated with Aave.",
      identity_note: "Stani Kulechov founded Aave.",
    }, founderAxes, frozen, rejection)).toBeNull();
    expect([
      "founder-fundamentals-cite-network-only-evidence",
      "grounded-founder-role-described-as-unverified",
      "grounded-founder-track-record-described-as-social-only",
    ]).toContain(rejection.mock.calls.at(-1)?.[0]);

    expect(validateAnalystVerdict({
      axes: [
        validAxis("F1_identity_verifiability", 10, role.artifactId),
        {
          ...validAxis("F2_track_record", 22, founder.artifactId),
          rationale: "Independent sources verify that Stani founded Aave; additional measurable venture outcomes remain incomplete.",
        },
      ],
      headline: "Independent sources verify Stani Kulechov as an Aave founder.",
      identity_note: "Stani Kulechov is founder and CEO of Aave Labs and founder of the Aave Protocol.",
    }, founderAxes, frozen)).not.toBeNull();
  });

  it("never lets social reach stand in for a founder track record", () => {
    const rejection = vi.fn();
    expect(validateAnalystVerdict({
      axes: [
        validAxis("F1_identity_verifiability", 8, F1_REF),
        {
          ...validAxis("F2_track_record", 8, F2_REF),
          rationale: "The track record is inferred from follower count and the claimed role rather than independently verified artifacts.",
        },
      ],
      headline: "The evidence packet has limited operating-history coverage.",
      identity_note: "Public identity evidence remains limited.",
    }, catalog, validationCatalog, rejection)).toBeNull();
    expect(rejection).toHaveBeenLastCalledWith("founder-track-record-described-as-social-only");
  });

  it("rejects network-only language in F2 even when it avoids saying track record", () => {
    const rejection = vi.fn();
    expect(validateAnalystVerdict({
      axes: [
        validAxis("F1_identity_verifiability", 8, F1_REF),
        {
          ...validAxis("F2_track_record", 8, F2_REF),
          rationale: "301K followers and four observed X follows support an established operating history.",
        },
      ],
      headline: "The evidence packet has limited operating-history coverage.",
      identity_note: "Public identity evidence remains limited.",
    }, catalog, validationCatalog, rejection)).toBeNull();
    expect(rejection).toHaveBeenLastCalledWith("founder-fundamentals-cite-network-only-evidence");
  });

  it("allows an explicit warning that followers do not establish track record", () => {
    const result = validateAnalystVerdict({
      axes: [
        validAxis("F1_identity_verifiability", 8, F1_REF),
        {
          ...validAxis("F2_track_record", 8, F2_REF),
          rationale: "Follower count is network context only and does not establish track record.",
        },
      ],
      headline: "The evidence packet has limited operating-history coverage.",
      identity_note: "Public identity evidence remains limited.",
    }, catalog, validationCatalog);

    expect(result).not.toBeNull();
  });

  it("does not treat a verified CEO or current role as verified founder status", () => {
    const founderAxes: AnalystAxis[] = [
      { axis: "F1_identity_verifiability", weight: 12, role: "FOUNDER" },
    ];
    const frozen = extractScoringEvidenceCatalog(buildScoringEvidencePacket({
      basicFacts: [{
        predicate: "current_role",
        value: "CEO, Example Labs",
        status: "verified",
        artifact_verified: true,
        sources: [{
          url: "https://example.com/leadership",
          excerpt: "The subject serves as CEO of Example Labs.",
          provider: "public-web",
          artifactVerified: true,
        }],
      }],
    }, founderAxes));
    const role = frozen.find((artifact) => artifact.operation === "basicFacts:current_role")!;

    expect(validateAnalystVerdict({
      axes: [{
        ...validAxis("F1_identity_verifiability", 9, role.artifactId),
        rationale: "The current CEO role is verified, while founder status remains unverified.",
      }],
      headline: "The current CEO role is verified, but founder status remains unverified.",
      identity_note: "The evidence confirms an executive role, not a founder relationship.",
    }, founderAxes, frozen)).not.toBeNull();
  });

  it("does treat a verified founder-company relationship as grounded founder status", () => {
    const founderAxes: AnalystAxis[] = [
      { axis: "F2_track_record", weight: 28, role: "FOUNDER" },
    ];
    const frozen = extractScoringEvidenceCatalog(buildScoringEvidencePacket({
      checkOutcomes: [{
        checkId: "founder-company-relationships",
        status: "confirmed",
        note: "Independent sources confirm the subject founded Example Labs.",
        provider: "public-web",
      }],
    }, founderAxes));
    const relationship = frozen.find((artifact) =>
      artifact.operation === "checkOutcomes:founder-company-relationships")!;
    const rejection = vi.fn();

    expect(validateAnalystVerdict({
      axes: [{
        ...validAxis("F2_track_record", 18, relationship.artifactId),
        rationale: "The founder relationship remains unverified.",
      }],
      headline: "The founder relationship remains unverified.",
      identity_note: "The subject is publicly associated with Example Labs.",
    }, founderAxes, frozen, rejection)).toBeNull();
    expect(rejection).toHaveBeenLastCalledWith("grounded-founder-role-described-as-unverified");
  });

  it.each([
    "Notable followers array is empty in the evidence packet.",
    "Notable follower evidence is unavailable.",
    "Observed network data remains absent.",
    "Zero notable followers were found.",
    "None of the accounts are notable followers.",
    "No direct observed network evidence is available.",
  ])("rejects the false observed-follower absence claim: %s", (falseAbsenceClaim) => {
    const networkAxes: AnalystAxis[] = [
      { axis: "F6_network_quality", weight: 12, role: "FOUNDER" },
    ];
    const frozen = extractScoringEvidenceCatalog(buildScoringEvidencePacket({
      notableFollowers: [{
        handle: "@a16zcrypto",
        name: "a16z crypto",
        category: "VC",
        provider: "twitterapi",
      }],
    }, networkAxes));
    const followerArtifact = frozen.find((artifact) => artifact.section === "notableFollowers")!;
    const rejection = vi.fn();

    expect(validateAnalystVerdict({
      axes: [{
        ...validAxis("F6_network_quality", 10, followerArtifact.artifactId),
        rationale: falseAbsenceClaim,
        gaps: ["Provider coverage of the wider network is partial."],
      }],
      headline: "The subject has an established public network.",
      identity_note: "Identity is resolved.",
    }, networkAxes, frozen, rejection)).toBeNull();
    expect(rejection).toHaveBeenLastCalledWith("grounded-notable-followers-described-as-absent");

    expect(validateAnalystVerdict({
      axes: [{
        ...validAxis("F6_network_quality", 10, followerArtifact.artifactId),
        rationale: "Observed followers include @a16zcrypto; provider coverage of the wider network is partial.",
      }],
      headline: "The subject has an established public network.",
      identity_note: "Identity is resolved.",
    }, networkAxes, frozen)).not.toBeNull();
  });

  it("accepts partitive and coverage-limited follower phrasing when observed followers are grounded", () => {
    const networkAxes: AnalystAxis[] = [
      { axis: "F1_identity_verifiability", weight: 12, role: "FOUNDER" },
      { axis: "F6_network_quality", weight: 12, role: "FOUNDER" },
    ];
    const frozen = extractScoringEvidenceCatalog(buildScoringEvidencePacket({
      notableFollowers: [{
        handle: "@a16zcrypto",
        name: "a16z crypto",
        category: "VC",
        provider: "twitterapi",
      }],
      basicFacts: [{
        predicate: "official_identity",
        value: "Verified public identity",
        status: "verified",
        artifact_verified: true,
        sources: [{
          url: "https://example.com/about",
          excerpt: "The subject's public identity is documented.",
          provider: "public-web",
          artifactVerified: true,
        }],
      }],
    }, networkAxes));
    const followerArtifact = frozen.find((artifact) => artifact.section === "notableFollowers")!;
    const identityArtifact = frozen.find((artifact) => artifact.operation === "basicFacts:official_identity")!;
    const rejection = vi.fn();

    expect(validateAnalystVerdict({
      axes: [
        {
          ...validAxis("F1_identity_verifiability", 9, identityArtifact.artifactId),
          rationale: "Identity rests on verified records; no direct observed network evidence is needed for this axis.",
        },
        {
          ...validAxis("F6_network_quality", 10, followerArtifact.artifactId),
          rationale: "None of the observed notable followers are flagged accounts; representative accounts include @a16zcrypto.",
          gaps: ["Notable follower depth beyond the first page is not documented by the provider."],
        },
      ],
      headline: "The subject has an established public network.",
      identity_note: "Identity is resolved.",
    }, networkAxes, frozen, rejection)).not.toBeNull();
    expect(rejection).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "missing axis",
      axes: [validAxis("F1_identity_verifiability", 10, F1_REF)],
    },
    {
      label: "duplicate axis",
      axes: [
        validAxis("F1_identity_verifiability", 10, F1_REF),
        validAxis("F1_identity_verifiability", 11, F1_REF),
      ],
    },
    {
      label: "unknown axis",
      axes: [
        validAxis("F1_identity_verifiability", 10, F1_REF),
        validAxis("MADE_UP", 1, F2_REF),
      ],
    },
    {
      label: "non-finite score",
      axes: [
        validAxis("F1_identity_verifiability", Number.NaN, F1_REF),
        validAxis("F2_track_record", 20, F2_REF),
      ],
    },
    {
      label: "out-of-range score",
      axes: [
        validAxis("F1_identity_verifiability", 13, F1_REF),
        validAxis("F2_track_record", 20, F2_REF),
      ],
    },
    {
      label: "fractional score",
      axes: [
        validAxis("F1_identity_verifiability", 10.5, F1_REF),
        validAxis("F2_track_record", 20, F2_REF),
      ],
    },
  ])("rejects a $label response", ({ axes }) => {
    expect(validateAnalystVerdict({ axes, headline: "bad", identity_note: "bad" }, catalog, validationCatalog)).toBeNull();
  });

  it.each([
    { label: "missing primary support ref", patch: { primaryEvidenceRef: undefined } },
    { label: "missing additional support refs", patch: { additionalEvidenceRefs: undefined } },
    { label: "missing counter refs", patch: { counterEvidenceRefs: undefined } },
    { label: "missing coverage refs", patch: { coverageRefs: undefined } },
    { label: "missing gaps", patch: { gaps: undefined } },
    { label: "unknown ref", patch: { primaryEvidenceRef: `art_v1_${"9".repeat(64)}` } },
    { label: "duplicate ref", patch: { additionalEvidenceRefs: [F1_REF] } },
    { label: "axis-ineligible ref", patch: { primaryEvidenceRef: F2_REF } },
    { label: "support/counter overlap", patch: { counterEvidenceRefs: [F1_REF] } },
    { label: "undeclared array-row field", patch: { ignoredEvidenceRefs: [F1_REF] } },
    { label: "blank rationale", patch: { rationale: "   " } },
  ])("rejects $label on a scored axis", ({ patch }) => {
    const axes = [
      { ...validAxis("F1_identity_verifiability", 10, F1_REF), ...patch },
      validAxis("F2_track_record", 20, F2_REF),
    ];
    expect(validateAnalystVerdict({
      axes,
      headline: "Complete result",
      identity_note: "Identity resolved",
    }, catalog, validationCatalog)).toBeNull();
  });

  it("conservatively removes support/counter overlap when independent support remains", () => {
    const alternateF1Ref = `art_v1_${"6".repeat(64)}`;
    const evidenceCatalog = [
      ...validationCatalog,
      axisArtifact(alternateF1Ref, ["F1_identity_verifiability"], "verified"),
    ];
    const raw = {
      axes: [
        {
          ...validAxis("F1_identity_verifiability", 8, F1_REF),
          additionalEvidenceRefs: [alternateF1Ref],
          counterEvidenceRefs: ["e001"],
        },
        validAxis("F2_track_record", 20, F2_REF),
      ],
      headline: "Independent support remains after conservative normalization.",
      identity_note: "Identity remains supported.",
    };

    const normalized = normalizeAnalystSupportCounterOverlap(raw, evidenceCatalog);
    const result = validateAnalystVerdict(normalized, catalog, evidenceCatalog);

    expect(normalized).not.toBe(raw);
    expect(result?.axes[0]).toMatchObject({
      evidenceRefs: [alternateF1Ref],
      counterEvidenceRefs: [F1_REF],
    });
  });

  it("does not erase the only support reference to rescue an overlapping row", () => {
    const raw = {
      axes: [
        {
          ...validAxis("F1_identity_verifiability", 8, F1_REF),
          counterEvidenceRefs: ["e001"],
        },
        validAxis("F2_track_record", 20, F2_REF),
      ],
      headline: "The only support reference is contradictory.",
      identity_note: "Identity remains unresolved.",
    };

    const normalized = normalizeAnalystSupportCounterOverlap(raw, validationCatalog);

    expect(normalized).toBe(raw);
    expect(validateAnalystVerdict(normalized, catalog, validationCatalog)).toBeNull();
  });

  it("keeps the sole-support overlap for strict rejection through the production normalizer sequence", () => {
    const raw = {
      axes: [
        {
          ...validAxis("F1_identity_verifiability", 8, F1_REF),
          counterEvidenceRefs: ["e001"],
        },
        validAxis("F2_track_record", 20, F2_REF),
      ],
      headline: "The only support reference is contradictory.",
      identity_note: "Identity remains supported by one contested artifact.",
    };

    let normalized = normalizeAnalystSupportCounterOverlap(raw, validationCatalog);
    normalized = normalizeAnalystCitationEligibility(normalized, validationCatalog);
    const rejection = vi.fn();

    expect(normalized).toBe(raw);
    expect(validateAnalystVerdict(normalized, catalog, validationCatalog, rejection)).toBeNull();
    expect(rejection).toHaveBeenLastCalledWith("support-counter-overlap:F1_identity_verifiability");
  });

  it("strips em and en dashes from model verdict copy deterministically", () => {
    const result = validateAnalystVerdict({
      axes: [
        {
          ...validAxis("F1_identity_verifiability", 10, F1_REF),
          rationale: "Verified identity\u2014the strongest signal in the packet.",
          gaps: ["Employment history for 2019\u20132023 remains unconfirmed."],
        },
        validAxis("F2_track_record", 20, F2_REF),
      ],
      headline: "Strong identity\u2014weaker documented history.",
      identity_note: "\u2014Identity is resolved\u2014",
    }, catalog, validationCatalog);

    expect(result).not.toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/[\u2013\u2014]/);
    expect(result?.headline).toBe("Strong identity, weaker documented history.");
    expect(result?.identity_note).toBe("Identity is resolved");
    expect(result?.axes[0]).toMatchObject({
      rationale: "Verified identity, the strongest signal in the packet.",
      gaps: ["Employment history for 2019-2023 remains unconfirmed."],
    });
  });

  it("drops cross-axis extras when eligible substantive support already remains", () => {
    const raw = {
      axes: [
        {
          ...validAxis("F1_identity_verifiability", 9, F1_REF),
          additionalEvidenceRefs: [F2_REF],
          coverageRefs: [F2_UNAVAILABLE_REF],
        },
        validAxis("F2_track_record", 20, F2_REF),
      ],
      headline: "Valid support remains after cross-axis cleanup.",
      identity_note: "Identity is supported.",
    };

    const normalized = normalizeAnalystCitationEligibility(raw, validationCatalog);
    const result = validateAnalystVerdict(normalized, catalog, validationCatalog);

    expect(normalized).not.toBe(raw);
    expect(result?.axes[0]).toMatchObject({ evidenceRefs: [F1_REF], counterEvidenceRefs: [] });
  });

  it("promotes an already-selected eligible additional citation when the primary belongs to another axis", () => {
    const alternateF1Ref = `art_v1_${"6".repeat(64)}`;
    const evidenceCatalog = [
      ...validationCatalog,
      axisArtifact(alternateF1Ref, ["F1_identity_verifiability"], "verified"),
    ];
    const raw = {
      axes: [
        {
          ...validAxis("F1_identity_verifiability", 9, F2_REF),
          additionalEvidenceRefs: [alternateF1Ref],
        },
        validAxis("F2_track_record", 20, F2_REF),
      ],
      headline: "Eligible selected support is promoted.",
      identity_note: "Identity is supported.",
    };

    const normalized = normalizeAnalystCitationEligibility(raw, evidenceCatalog);
    const result = validateAnalystVerdict(normalized, catalog, evidenceCatalog);

    expect(result?.axes[0]).toMatchObject({ evidenceRefs: [alternateF1Ref] });
  });

  it.each([F2_UNAVAILABLE_REF, F2_CHECKED_EMPTY_REF])(
    "rejects coverage-only evidence as substantive support even when a gap is supplied (%s)",
    (coverageRef) => {
      const axes = [
        validAxis("F1_identity_verifiability", 10, F1_REF),
        {
          ...validAxis("F2_track_record", 8, coverageRef),
          gaps: ["No eligible track-record artifact was available."],
        },
      ];
      expect(validateAnalystVerdict({
        axes,
        headline: "Incomplete evidence",
        identity_note: "Identity resolved",
      }, catalog, validationCatalog)).toBeNull();
    },
  );

  it("requires a gap only for genuinely unavailable coverage", () => {
    const result = validateAnalystVerdict({
      axes: [
        validAxis("F1_identity_verifiability", 10, F1_REF),
        {
          ...validAxis("F2_track_record", 8, F2_REF),
          coverageRefs: [F2_UNAVAILABLE_REF],
          gaps: ["One track-record provider did not return a result."],
        },
      ],
      headline: "Substantive evidence with a disclosed coverage gap",
      identity_note: "Identity resolved",
    }, catalog, validationCatalog);

    expect(result?.axes[1]).toMatchObject({
      evidenceRefs: [F2_REF, F2_UNAVAILABLE_REF],
      gaps: ["One track-record provider did not return a result."],
    });
  });

  it("keeps a completed checked-empty screen without inventing a gap", () => {
    const result = validateAnalystVerdict({
      axes: [
        validAxis("F1_identity_verifiability", 10, F1_REF),
        {
          ...validAxis("F2_track_record", 8, F2_REF),
          coverageRefs: [F2_CHECKED_EMPTY_REF],
          gaps: [],
        },
      ],
      headline: "Substantive evidence with a completed clear screen",
      identity_note: "Identity resolved",
    }, catalog, validationCatalog);

    expect(result?.axes[1]).toMatchObject({
      evidenceRefs: [F2_REF],
      gaps: [],
    });
    expect(validationCatalog.some(({ artifactId }) => artifactId === F2_CHECKED_EMPTY_REF)).toBe(true);
  });

  it("keeps an absence screen out of positive founder identity support when no gap exists", () => {
    const sanctionsClearRef = `art_v1_${"6".repeat(64)}`;
    const identityEvidence = axisArtifact(F1_REF, ["F1_identity_verifiability"]);
    const sanctionsClear = {
      ...axisArtifact(sanctionsClearRef, ["F1_identity_verifiability"], "checked_empty"),
      provider: "opensanctions",
      operation: "sourceArtifacts:sanctions_screen",
      section: "sourceArtifacts",
      title: "US Treasury OFAC SDN exact-name screen",
    };

    const result = validateAnalystVerdict({
      axes: [{
        ...validAxis("F1_identity_verifiability", 11, F1_REF),
        coverageRefs: [sanctionsClearRef],
        gaps: [],
      }],
      headline: "Verified public identity and current authority govern the assessment.",
      identity_note: "The founder identity is resolved through public first-party evidence.",
    }, [{ axis: "F1_identity_verifiability", weight: 12, role: "FOUNDER" }], [identityEvidence, sanctionsClear]);

    expect(result?.axes[0]).toMatchObject({
      evidenceRefs: [F1_REF],
      gaps: [],
    });
    expect([identityEvidence, sanctionsClear]).toContainEqual(
      expect.objectContaining({ artifactId: sanctionsClearRef, verification: "checked_empty" }),
    );
  });

  it("accepts every documented array boundary and rejects one item beyond each limit", () => {
    const axis = "F1_identity_verifiability";
    const artifact = (index: number, verification: AxisEvidenceRecord["verification"]) =>
      axisArtifact(`art_v1_${index.toString(16).padStart(64, "0")}`, [axis], verification);
    const support = Array.from({ length: 9 }, (_, index) => artifact(100 + index, "verified"));
    const counter = Array.from({ length: 9 }, (_, index) => artifact(200 + index, "reported"));
    const coverage = Array.from({ length: 5 }, (_, index) =>
      artifact(300 + index, index % 2 === 0 ? "unavailable" : "checked_empty"));
    const evidence = [...support, ...counter, ...coverage];
    const row = {
      axis,
      score: 10,
      rationale: "Evidence-backed rationale at every documented boundary.",
      primaryEvidenceRef: support[0].artifactId,
      additionalEvidenceRefs: support.slice(1, 8).map(({ artifactId }) => artifactId),
      counterEvidenceRefs: counter.slice(0, 8).map(({ artifactId }) => artifactId),
      coverageRefs: coverage.slice(0, 4).map(({ artifactId }) => artifactId),
      gaps: Array.from({ length: 6 }, (_, index) => `Material gap ${index + 1}.`),
    };
    const payload = (axisRow: typeof row) => ({
      axes: [axisRow],
      headline: "Boundary-valid result",
      identity_note: "Identity resolved",
    });
    const singleAxisCatalog: AnalystAxis[] = [{ axis, weight: 12, role: "FOUNDER" }];

    const accepted = validateAnalystVerdict(payload(row), singleAxisCatalog, evidence);
    expect(accepted?.axes[0]).toMatchObject({
      evidenceRefs: [
        support[0].artifactId,
        ...support.slice(1, 8).map(({ artifactId }) => artifactId),
      ],
      counterEvidenceRefs: counter.slice(0, 8).map(({ artifactId }) => artifactId),
      gaps: row.gaps,
    });

    const overLimitRows = [
      { ...row, additionalEvidenceRefs: support.slice(1, 9).map(({ artifactId }) => artifactId) },
      { ...row, counterEvidenceRefs: counter.map(({ artifactId }) => artifactId) },
      { ...row, coverageRefs: coverage.map(({ artifactId }) => artifactId) },
      { ...row, gaps: Array.from({ length: 7 }, (_, index) => `Material gap ${index + 1}.`) },
    ];
    for (const overLimitRow of overLimitRows) {
      expect(validateAnalystVerdict(payload(overLimitRow), singleAxisCatalog, evidence)).toBeNull();
    }
  });

  it("rejects coverage-only artifacts as counter-evidence", () => {
    const axes = [
      validAxis("F1_identity_verifiability", 10, F1_REF),
      { ...validAxis("F2_track_record", 8, F2_REF), counterEvidenceRefs: [F2_CHECKED_EMPTY_REF] },
    ];
    expect(validateAnalystVerdict({
      axes,
      headline: "Invalid counter evidence",
      identity_note: "Identity resolved",
    }, catalog, validationCatalog)).toBeNull();
  });

  it.each([
    { headline: "", identity_note: "Identity resolved" },
    { headline: "Complete result", identity_note: "   " },
  ])("rejects blank headline or identity note", ({ headline, identity_note }) => {
    expect(validateAnalystVerdict({
      axes: [
        validAxis("F1_identity_verifiability", 10, F1_REF),
        validAxis("F2_track_record", 20, F2_REF),
      ],
      headline,
      identity_note,
    }, catalog, validationCatalog)).toBeNull();
  });

  it("builds bounded valid JSON without allowing long context to cut off findings", () => {
    const packet = buildAnalystEvidencePacket({
      profile: { handle: "@subject", bio: "b".repeat(20_000) },
      recentActivity: Array.from({ length: 100 }, (_, i) => `post ${i} ${"x".repeat(4_000)}`),
      ventures: Array.from({ length: 100 }, (_, i) => ({ project_name: `project-${i}`, notes: "v".repeat(4_000) })),
      testimonials: Array.from({ length: 100 }, (_, i) => ({ claimed_endorser_name: `person-${i}`, notes: "t".repeat(4_000) })),
      findings: [{
        finding_type: "DeterministicFinding",
        claim: "material finding survives",
        source_url: "https://example.com/artifact",
        verification_status: "Verified",
        independent_source_count: 1,
        evidence_origin: "deterministic",
        artifact_verified: true,
      }],
      sourceArtifacts: [{
        kind: "press",
        provider: "google-news",
        title: "Material source",
        sourceUrl: "https://example.com/source",
        capturedAt: "2026-07-11T12:00:00.000Z",
        contentHash: "a".repeat(64),
        match: "exact_name",
      }],
      profileAuthenticity: {
        provider: "claude-vision",
        capturedAt: "2026-07-11T12:00:00.000Z",
        imageData: "base64-secret-image-bytes",
        mediaType: "image/jpeg",
        imageContentHash: "b".repeat(64),
        classification: "real_candid",
        confidence: 0.9,
        flag: false,
        tells: ["natural lighting"],
        note: "Visual triage only.",
      },
      trustGraphScreen: {
        provider: "argus-graph",
        capturedAt: "2026-07-11T12:00:00.000Z",
        status: "risk",
        contributionCount: 2,
        qualifiedContributionCount: 2,
        sourceContentHash: "c".repeat(64),
        severity: "avoid",
        line: "One exact adverse connection.",
        connections: [{
          other: "@failed",
          otherReportVersionId: "00000000-0000-4000-8000-000000000033",
          otherAttestation: "server_collected",
          otherCompleteness: "complete",
          otherVerdict: "FAIL",
          qualified: true,
          direct: false,
          ties: [{
            key: "wallet:evm:0xabc",
            label: "shared deployer",
            type: "Identity",
            strength: "hard",
            subjectEdgeTypes: ["DEPLOYED"],
            otherEdgeTypes: ["DEPLOYED"],
          }],
        }],
      },
      checkOutcomes: [{ checkId: "news-press", status: "confirmed", provider: "google-news" }],
      providerRuns: [{ id: "offchain-diligence", state: "partial", detail: "CourtListener failed" }],
    });

    expect(packet.length).toBeLessThanOrEqual(ANALYST_EVIDENCE_MAX_CHARS);
    const parsed = JSON.parse(packet);
    expect(parsed.findings[0].claim).toBe("material finding survives");
    expect(parsed.findings[0].source_url).toBe("https://example.com/artifact");
    expect(parsed.coverage.recentActivity.available).toBe(100);
    expect(parsed.coverage.recentActivity.included).toBeLessThanOrEqual(12);
    expect(parsed.sourceArtifacts[0]).toMatchObject({ contentHash: "a".repeat(64) });
    expect(parsed.profileAuthenticity).toMatchObject({ imageContentHash: "b".repeat(64), classification: "real_candid" });
    expect(parsed.profileAuthenticity).not.toHaveProperty("imageData");
    expect(packet).not.toContain("base64-secret-image-bytes");
    expect(parsed.trustGraphScreen.connections[0]).toMatchObject({ qualified: true, otherVerdict: "FAIL" });
    expect(parsed.trustGraphScreen.connections[0].ties[0]).toMatchObject({ key: "wallet:evm:0xabc", strength: "hard" });
    expect(parsed.checkOutcomes[0]).toMatchObject({ checkId: "news-press", status: "confirmed" });
    expect(parsed.providerRuns[0]).toMatchObject({ id: "offchain-diligence", state: "partial" });
  });

  it("prioritizes frozen graph predicates ahead of descriptive finding overflow", () => {
    const descriptive = Array.from({ length: 30 }, (_, index) => ({
      finding_type: "ContextLead",
      claim: `descriptive lead ${index}`,
      source_url: `https://example.com/${index}`,
      verification_status: "Reported",
      independent_source_count: 1,
      polarity: 0,
    }));
    const graph = {
      finding_type: "TrustGraphConnection",
      claim: "Exact graph predicate must survive the evidence budget.",
      source_url: "",
      verification_status: "Verified",
      independent_source_count: 1,
      polarity: -1,
      evidence_origin: "deterministic",
      artifact_verified: true,
      content_hash: "d".repeat(64),
      trust_graph: {
        tie_key: "email:dev@example.com",
        tie_type: "Identity",
        tie_strength: "hard",
        subject_edge_types: ["IDENTITY_EMAIL"],
        other_edge_types: ["COMMIT_EMAIL"],
        other_report_version_id: "00000000-0000-4000-8000-000000000044",
        other_attestation: "server_collected",
        other_completeness: "complete",
        other_verdict: "FAIL",
      },
    };

    const parsed = JSON.parse(buildAnalystEvidencePacket({ findings: [...descriptive, graph] }));

    expect(parsed.coverage.findings).toEqual({ available: 31, included: 24 });
    expect(parsed.findings[0]).toMatchObject({
      finding_type: "TrustGraphConnection",
      content_hash: "d".repeat(64),
      trust_graph: expect.objectContaining({ tie_type: "Identity", other_verdict: "FAIL" }),
    });
  });

  it("separates associate and model leads from subject-scoring findings with explicit scope", () => {
    const direct = {
      finding_type: "LegalCaseNameLead",
      claim: "Evidence about the audited subject.",
      source_url: "https://example.com/subject",
      verification_status: "Verified",
      independent_source_count: 2,
      polarity: -1,
      evidence_origin: "deterministic",
      artifact_verified: true,
      finding_scope: {
        scope: "direct_subject",
        target_entity_key: "@subject",
        target_entity_type: "person",
        relationship_to_subject: "self",
        relationship_label: "audited subject",
      },
    };
    const associateLead = {
      finding_type: "AdverseLead",
      claim: "A complaint page was surfaced about @associate.",
      source_url: "https://example.com/associate-candidate",
      verification_status: "Reported",
      independent_source_count: 1,
      polarity: -1,
      evidence_origin: "model_lead",
      artifact_verified: false,
      finding_scope: {
        scope: "related_entity",
        target_entity_key: "@associate",
        target_entity_type: "person",
        relationship_to_subject: "associate",
        relationship_label: "recorded collaborator",
      },
    };
    const mismatchedDirectTarget = {
      ...direct,
      claim: "A forged direct scope actually names another account.",
      finding_scope: {
        ...direct.finding_scope,
        target_entity_key: "@somebody_else",
      },
    };

    const parsed = JSON.parse(buildAnalystEvidencePacket({
      profile: { handle: "@subject" },
      findings: [associateLead, mismatchedDirectTarget, direct],
    }));

    expect(parsed.schema_version).toBe(3);
    expect(parsed.coverage.findings).toEqual({ available: 1, included: 1 });
    expect(parsed.coverage.investigative_leads).toEqual({ available: 2, included: 2 });
    expect(parsed.findings).toEqual([expect.objectContaining({ claim: direct.claim })]);
    expect(parsed.investigative_leads).toEqual([
      expect.objectContaining({
        claim: associateLead.claim,
        finding_scope: expect.objectContaining({
          scope: "related_entity",
          target_entity_key: "@associate",
          relationship_to_subject: "associate",
        }),
      }),
      expect.objectContaining({
        claim: mismatchedDirectTarget.claim,
        finding_scope: expect.objectContaining({ target_entity_key: "@somebody_else" }),
      }),
    ]);
    expect(parsed.finding_scope_policy.investigative_leads).toContain("Never attribute");
  });

  it("completely removes investigative leads from the scorer packet while retaining legitimate evidence", () => {
    const direct = {
      finding_type: "Exit",
      claim: "DIRECT_SUBJECT_FINDING_RETAINED",
      source_url: "https://example.com/direct",
      verification_status: "Verified",
      independent_source_count: 2,
      polarity: -1,
      evidence_origin: "deterministic",
      artifact_verified: true,
      finding_scope: {
        scope: "direct_subject",
        target_entity_key: "@subject",
        target_entity_type: "person",
        relationship_to_subject: "self",
      },
    };
    const modelLead = {
      ...direct,
      claim: "MODEL_LEAD_MUST_NOT_REACH_SCORER",
      source_url: "https://example.com/model-lead",
      evidence_origin: "model_lead",
      artifact_verified: false,
    };
    const relatedLead = {
      ...direct,
      claim: "RELATED_ENTITY_MUST_NOT_REACH_SCORER",
      source_url: "https://example.com/related",
      finding_scope: {
        scope: "related_entity",
        target_entity_key: "@associate",
        target_entity_type: "person",
        relationship_to_subject: "associate",
      },
    };

    const packet = buildScoringEvidencePacket({
      profile: {
        handle: "@subject",
        name: "Subject Person",
        bio: "Public builder",
        profile_collection_state: "resolved",
        profile_provider: "twitterapi",
      },
      team: [{
        name: "Named Teammate",
        role: "CTO",
        linkedin: "https://linkedin.com/in/teammate",
        source: "team page",
        provider: "team-page",
        evidence_origin: "deterministic",
        artifact_verified: true,
      }],
      wallets: [{ chain: "ethereum", address: "0x123", attribution: "self-disclosed" }],
      ventures: [{ project_name: "FIXTURE_VENTURE_MUST_NOT_REACH_SCORER", evidence_origin: "model_lead", artifact_verified: false }],
      testimonials: [{ claimed_endorser_handle: "@fixture_endorser", evidence_origin: "model_lead", artifact_verified: false }],
      promotions: [{ ticker: "FIXTURE_PROMO", evidence_origin: "model_lead", artifact_verified: false }],
      checkOutcomes: [{ checkId: "identity-resolution", status: "confirmed", provider: "github" }],
      providerRuns: [{ id: "github", state: "executed", detail: "operational telemetry only" }],
      findings: [modelLead, relatedLead, direct],
      investigative_leads: [{ claim: "SEPARATE_LEAD_ARRAY_MUST_NOT_REACH_SCORER" }],
    }, catalog);
    const parsed = JSON.parse(packet);
    const frozenCatalog = extractScoringEvidenceCatalog(packet);

    expect(parsed).not.toHaveProperty("investigative_leads");
    expect(parsed).not.toHaveProperty("coverage");
    expect(parsed.finding_scope_policy).not.toHaveProperty("investigative_leads");
    expect(parsed.findings).toEqual([
      expect.objectContaining({ claim: "DIRECT_SUBJECT_FINDING_RETAINED" }),
    ]);
    expect(parsed.profile).toMatchObject({ handle: "@subject", name: "Subject Person" });
    expect(parsed.team[0]).toMatchObject({ name: "Named Teammate", role: "CTO" });
    expect(parsed.wallets).toEqual([]);
    expect(parsed.checkOutcomes[0]).toMatchObject({
      checkId: "identity-resolution",
      status: "confirmed",
    });
    expect(parsed.profile.artifactId).toMatch(ARTIFACT_ID_FOR_TEST);
    expect(parsed.findings[0].artifactId).toMatch(ARTIFACT_ID_FOR_TEST);
    expect(frozenCatalog.length).toBeGreaterThan(0);
    expect(frozenCatalog.every((artifact) => artifact.artifactId === `art_v1_${artifact.contentHash}`)).toBe(true);
    expect(frozenCatalog.some((artifact) => artifact.section === "findings" && artifact.scope === "direct_subject")).toBe(true);
    expect(frozenCatalog.find((artifact) => artifact.section === "profile")?.provider).toBe("twitterapi");
    expect(frozenCatalog.find((artifact) => artifact.section === "team")?.provider).toBe("team-page");
    expect(parsed).not.toHaveProperty("providerRuns");
    expect(frozenCatalog.some((artifact) => artifact.section === "providerRuns")).toBe(false);
    expect(packet).not.toContain("MODEL_LEAD_MUST_NOT_REACH_SCORER");
    expect(packet).not.toContain("RELATED_ENTITY_MUST_NOT_REACH_SCORER");
    expect(packet).not.toContain("SEPARATE_LEAD_ARRAY_MUST_NOT_REACH_SCORER");
    expect(packet).not.toContain("FIXTURE_VENTURE_MUST_NOT_REACH_SCORER");
    expect(packet).not.toContain("fixture_endorser");
    expect(packet).not.toContain("FIXTURE_PROMO");
    expect(packet).not.toContain("model_lead");
    expect(packet).not.toContain("@associate");
  });

  it("keeps namesake legal and sanctions leads visible to investigators but outside scoring", () => {
    const findingScope = {
      scope: "direct_subject",
      target_entity_key: "@subject",
      target_entity_type: "person",
      relationship_to_subject: "self",
    };
    const namesakeFindings = [
      {
        finding_type: "LegalCaseNameLead",
        claim: "COURT_NAME_ONLY_REVIEW_LEAD",
        source_url: "https://example.com/court-name-lead",
        verification_status: "Verified",
        polarity: -1,
        evidence_origin: "deterministic",
        artifact_verified: true,
        finding_scope: findingScope,
      },
      {
        finding_type: "SanctionsNameLead",
        claim: "SANCTIONS_NAME_ONLY_REVIEW_LEAD",
        source_url: "https://example.com/sanctions-name-lead",
        verification_status: "Verified",
        polarity: -1,
        evidence_origin: "deterministic",
        artifact_verified: true,
        finding_scope: findingScope,
      },
    ];
    const sourceArtifacts = [
      {
        kind: "legal_case",
        provider: "courtlistener",
        match: "candidate",
        title: "COURT_CAPTION_CANDIDATE",
        sourceUrl: "https://example.com/court-candidate",
      },
      {
        kind: "sanctions_screen",
        provider: "opensanctions",
        match: "exact_name",
        title: "SANCTIONS_EXACT_NAME_CANDIDATE",
        sourceUrl: "https://example.com/sanctions-candidate",
      },
    ];
    const checkOutcomes = [
      {
        checkId: "us-legal-history",
        status: "finding",
        provider: "courtlistener",
        note: "COURT_CHECK_IDENTITY_REVIEW",
      },
      {
        checkId: "ofac-sanctions-name",
        status: "finding",
        provider: "opensanctions",
        note: "SANCTIONS_CHECK_IDENTITY_REVIEW",
      },
    ];
    const legalFact = (scope: "direct_subject" | "related_entity", suffix: string) => ({
      factId: `basic_fact_legal_${suffix}`,
      subjectKey: "@subject",
      predicate: "legal_regulatory_event",
      value: `SEC settlement ${suffix}`,
      normalizedValue: `sec settlement ${suffix}`,
      status: "verified",
      critical: true,
      eventStatus: "settled",
      attributedEntity: scope === "direct_subject" ? "Subject Person" : "Related Company",
      attributionScope: scope,
      sources: [{
        url: `https://www.sec.gov/example-${suffix}`,
        sourceClass: "regulatory_or_onchain",
        relation: "supports",
        excerpt: scope === "direct_subject"
          ? "The SEC states that Subject Person settled the attributed matter."
          : "The SEC states that Related Company settled the attributed matter.",
        contentHash: suffix.padEnd(64, suffix[0]),
        capturedAt: "2026-07-13T12:00:00.000Z",
        provider: "public-web",
        artifactVerified: true,
      }],
      evidence_origin: "deterministic",
      artifact_verified: true,
      provider: "public-web",
    });
    const input = {
      findings: namesakeFindings,
      sourceArtifacts,
      checkOutcomes,
      basicFacts: [legalFact("direct_subject", "direct"), legalFact("related_entity", "related")],
    };
    const investigatorPacket = buildAnalystEvidencePacket(input);
    const axes: AnalystAxis[] = [
      { axis: "F5_reputation_integrity", weight: 18, role: "FOUNDER" },
    ];
    const scoringPacket = buildScoringEvidencePacket(input, axes);
    const parsed = JSON.parse(scoringPacket);
    const frozen = extractScoringEvidenceCatalog(scoringPacket, axes);

    expect(investigatorPacket).toContain("COURT_NAME_ONLY_REVIEW_LEAD");
    expect(investigatorPacket).toContain("SANCTIONS_NAME_ONLY_REVIEW_LEAD");
    expect(investigatorPacket).toContain("COURT_CAPTION_CANDIDATE");
    expect(investigatorPacket).toContain("SANCTIONS_EXACT_NAME_CANDIDATE");
    expect(investigatorPacket).toContain("COURT_CHECK_IDENTITY_REVIEW");
    expect(investigatorPacket).toContain("SANCTIONS_CHECK_IDENTITY_REVIEW");
    expect(parsed.findings).toEqual([]);
    expect(parsed.sourceArtifacts).toEqual([]);
    expect(parsed.checkOutcomes).toEqual([]);
    expect(parsed.basicFacts).toEqual([
      expect.objectContaining({ factId: "basic_fact_legal_direct", attributionScope: "direct_subject" }),
    ]);
    expect(frozen).toContainEqual(expect.objectContaining({
      section: "basicFacts",
      title: "SEC settlement direct",
      verification: "verified",
      eligibleAxes: ["F5_reputation_integrity"],
    }));
    expect(frozen.some((artifact) => artifact.operation === "findings:LegalCaseNameLead")).toBe(false);
    expect(frozen.some((artifact) => artifact.operation === "findings:SanctionsNameLead")).toBe(false);
    expect(parsed.axisGaps).toEqual([]);
  });

  it("uses deterministic content-addressed IDs and synthesizes only missing-axis gap artifacts", () => {
    const first = buildScoringEvidencePacket({
      profile: { handle: "@subject", display_name: "Subject", bio: "Builder", profile_collection_state: "resolved", profile_provider: "twitterapi" },
    }, catalog);
    const second = buildScoringEvidencePacket({
      profile: { bio: "Builder", display_name: "Subject", handle: "@subject", profile_provider: "twitterapi", profile_collection_state: "resolved" },
    }, catalog);
    const firstCatalog = extractScoringEvidenceCatalog(first);
    const secondCatalog = extractScoringEvidenceCatalog(second);
    const firstProfile = firstCatalog.find((artifact) => artifact.section === "profile");
    const secondProfile = secondCatalog.find((artifact) => artifact.section === "profile");

    expect(firstProfile?.artifactId).toBe(secondProfile?.artifactId);
    expect(firstProfile?.eligibleAxes).toContain("F1_identity_verifiability");
    expect(firstProfile?.eligibleAxes).not.toContain("F2_track_record");
    const parsed = JSON.parse(first);
    expect(parsed.axisGaps).toEqual([
      expect.objectContaining({
        axis: "F2_track_record",
        status: "unavailable",
        artifactId: expect.stringMatching(ARTIFACT_ID_FOR_TEST),
      }),
    ]);
    expect(firstCatalog).toContainEqual(expect.objectContaining({
      artifactId: parsed.axisGaps[0].artifactId,
      section: "axisGaps",
      eligibleAxes: ["F2_track_record"],
      verification: "unavailable",
    }));
  });

  it("preserves one substantive artifact per covered axis while pruning a large 14-axis packet", () => {
    const roles = [SubjectClass.FOUNDER, SubjectClass.INVESTOR, SubjectClass.MEMBER];
    const axes: AnalystAxis[] = roles.flatMap((role) =>
      Object.entries(getProfile(role).axes).map(([axis, weight]) => ({ axis, weight, role })));
    const packet = buildScoringEvidencePacket({
      profile: {
        handle: "@subject",
        display_name: "Subject",
        bio: "Named founder, investor, and community contributor",
        website: "https://subject.example",
        profile_collection_state: "resolved",
        profile_provider: "twitterapi",
        profile_captured_at: "2026-07-11T12:00:00.000Z",
      },
      ventures: [{
        project_name: "Verified Venture",
        role: "founder and investor",
        outcome: "Active",
        artifact_verified: true,
      }],
      testimonials: [{
        claimed_endorser_handle: "@verified_backer",
        claimed_relationship: "repeat backer",
        artifact_verified: true,
      }],
      recentActivity: Array.from({ length: 12 }, (_, index) => ({
        provider: "twitterapi",
        text: `Documented subject activity ${index} ${"x".repeat(300)}`,
        capturedAt: "2026-07-11T12:00:00.000Z",
      })),
      sourceArtifacts: [
        {
          kind: "portfolio_relationship",
          provider: "portfolio-web",
          title: "Subject → Verified Portfolio Company",
          excerpt: "Verified Portfolio Company appears on the subject's official portfolio page.",
          sourceUrl: "https://subject.example/portfolio/verified-company",
          capturedAt: "2026-07-11T12:00:00.000Z",
          contentHash: "c".repeat(64),
          sourceContentHash: "d".repeat(64),
          match: "relationship_confirmed",
          relationship: "invested_in",
          subjectName: "Subject",
          projectName: "Verified Portfolio Company",
          sourceClass: "first_party_subject",
        },
        verifiedFundScaleArtifact(),
        ...Array.from({ length: 22 }, (_, index) => ({
          kind: "press",
          provider: "google-news",
          title: `Verified source ${index}`,
          excerpt: `Independent evidence ${index} ${"e".repeat(300)}`,
          sourceUrl: `https://news.example/source-${index}`,
          capturedAt: "2026-07-11T12:00:00.000Z",
          contentHash: (index + 10).toString(16).padStart(64, "0"),
          match: "exact_name",
        })),
      ],
      checkOutcomes: Array.from({ length: 20 }, (_, index) => ({
        checkId: index % 2 === 0 ? "us-legal-history" : "news-press",
        status: "unavailable",
        provider: `coverage-provider-${index}`,
        note: `Provider coverage unavailable ${index} ${"n".repeat(200)}`,
      })),
    }, axes);
    const parsed = JSON.parse(packet) as Record<string, unknown>;
    const frozenCatalog = extractScoringEvidenceCatalog(packet);
    const substantive = frozenCatalog.filter((artifact) =>
      artifact.verification !== "checked_empty" && artifact.verification !== "unavailable");

    expect(axes).toHaveLength(14);
    expect(packet.length).toBeLessThanOrEqual(ANALYST_EVIDENCE_MAX_CHARS);
    expect((parsed.recentActivity as unknown[]).length).toBeLessThan(12);
    expect(parsed.testimonials).toEqual([expect.objectContaining({
      claimed_endorser_handle: "@verified_backer",
    })]);
    expect(axes.every(({ axis }) => substantive.some((artifact) => artifact.eligibleAxes.includes(axis)))).toBe(true);
    expect(inspectAnalystScoringPreflight(axes, packet)).toMatchObject({
      state: "ready",
      requestedAxisCount: 14,
      missingSubstantiveAxes: [],
    });
  });

  it("retains the named project team when a large packet also has a generic confirmed team check", () => {
    const axes: AnalystAxis[] = Object.entries(getProfile(SubjectClass.PROJECT).axes)
      .map(([axis, weight]) => ({ axis, weight, role: SubjectClass.PROJECT }));
    const fatNote = (label: string, index: number) => `${label} ${index} ${"x".repeat(300)}`;
    const packet = buildScoringEvidencePacket({
      profile: {
        handle: "@project",
        display_name: "Project",
        profile_collection_state: "resolved",
        profile_provider: "twitterapi",
      },
      team: [
        {
          name: "Meow",
          handle: "@weremeow",
          role: "co-founder of Project",
          provider: "team-page",
          sourceUrl: "https://docs.example.com/tokenomics",
          evidence_origin: "deterministic",
          artifact_verified: true,
        },
        {
          name: "Siong",
          handle: "@sssionggg",
          role: "core cofounder",
          provider: "team-page",
          sourceUrl: "https://forum.example.com/founders",
          evidence_origin: "deterministic",
          artifact_verified: true,
        },
      ],
      recentActivity: Array.from({ length: 12 }, (_, index) => ({
        provider: "twitterapi",
        text: fatNote("Recent project activity", index),
      })),
      notableFollowers: Array.from({ length: 16 }, (_, index) => ({
        handle: `@follower${index}`,
        note: fatNote("Notable relationship", index),
      })),
      checkOutcomes: [
        {
          checkId: "project-team-identity",
          status: "confirmed",
          provider: "team-page/post-scan",
          note: "Project identity resolved through two independently collected team records.",
        },
        ...Array.from({ length: 19 }, (_, index) => ({
          checkId: index % 2 === 0 ? "news-press" : "identity-continuity",
          status: "unavailable",
          provider: `coverage-provider-${index}`,
          note: fatNote("Coverage detail", index),
        })),
      ],
      sourceArtifacts: Array.from({ length: 24 }, (_, index) => ({
        kind: "press",
        provider: "google-news",
        title: `Independent project source ${index}`,
        excerpt: fatNote("Independent project evidence", index),
        sourceUrl: `https://news.example/project-${index}`,
        capturedAt: "2026-07-12T12:00:00.000Z",
        contentHash: (index + 1).toString(16).padStart(64, "0"),
        match: "exact_name",
      })),
    }, axes);
    const parsed = JSON.parse(packet) as { team: Array<{ name: string; handle?: string }> };
    const frozen = extractScoringEvidenceCatalog(packet);

    expect(packet.length).toBeLessThanOrEqual(ANALYST_EVIDENCE_MAX_CHARS);
    expect(parsed.team).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Meow", handle: "@weremeow" }),
      expect.objectContaining({ name: "Siong", handle: "@sssionggg" }),
    ]));
    expect(frozen.filter((artifact) => artifact.section === "team")).toHaveLength(2);
  });

  it("does not let generic founder and activity rows manufacture project token or backing coverage", () => {
    const axes: AnalystAxis[] = Object.entries(getProfile(SubjectClass.PROJECT).axes)
      .map(([axis, weight]) => ({ axis, weight, role: SubjectClass.PROJECT }));
    const packet = buildScoringEvidencePacket({
      profile: {
        handle: "@sparse_project",
        display_name: "Sparse Project",
        bio: "Building a live software product",
        profile_collection_state: "resolved",
        profile_provider: "twitterapi",
      },
      team: [{
        name: "Named Founder",
        role: "Founder and head of Investor Relations",
        provider: "team-page",
        sourceUrl: "https://sparse.example/team",
        artifact_verified: true,
      }],
      recentActivity: [{
        provider: "twitterapi",
        text: "Released a product update for a supply chain contract workflow.",
      }],
    }, axes);
    const catalog = extractScoringEvidenceCatalog(packet);
    const team = catalog.find((artifact) => artifact.section === "team");
    const activity = catalog.find((artifact) => artifact.section === "recentActivity");

    expect(team?.eligibleAxes).not.toContain("P4_backing_and_partners");
    expect(activity?.eligibleAxes).not.toContain("P3_token_conduct");
    expect(activity?.eligibleAxes).not.toContain("P6_transparency_integrity");
    expect(inspectAnalystScoringPreflight(axes, packet)).toMatchObject({
      state: "insufficient_evidence",
      missingSubstantiveAxes: ["P3_token_conduct", "P4_backing_and_partners", "P5_traction_and_liveness", "P6_transparency_integrity"],
    });
  });

  it("routes explicit project advisor, token, and governance evidence to their own axes", () => {
    const axes: AnalystAxis[] = Object.entries(getProfile(SubjectClass.PROJECT).axes)
      .map(([axis, weight]) => ({ axis, weight, role: SubjectClass.PROJECT }));
    const packet = buildScoringEvidencePacket({
      team: [{
        name: "Named Advisor",
        role: "Strategic advisor and seed investor",
        provider: "team-page",
        sourceUrl: "https://project.example/advisors",
        artifact_verified: true,
      }],
      recentActivity: [{
        provider: "twitterapi",
        text: "Published the token contract address, vesting schedule, governance proposal, and security audit.",
      }],
    }, axes);
    const catalog = extractScoringEvidenceCatalog(packet);
    const team = catalog.find((artifact) => artifact.section === "team");
    const activity = catalog.find((artifact) => artifact.section === "recentActivity");

    expect(team?.eligibleAxes).toContain("P4_backing_and_partners");
    expect(activity?.eligibleAxes).toEqual(expect.arrayContaining([
      "P3_token_conduct",
      "P6_transparency_integrity",
    ]));
  });

  it("keeps verified project control and conflict facts in the scoring packet", () => {
    const axes: AnalystAxis[] = Object.entries(getProfile(SubjectClass.PROJECT).axes)
      .map(([axis, weight]) => ({ axis, weight, role: SubjectClass.PROJECT }));
    const packet = buildScoringEvidencePacket({
      basicFacts: [
        { predicate: "control", value: "A 3-of-5 multisig with named signers controls the protocol admin keys", status: "verified", artifact_verified: true },
        { predicate: "conflict_of_interest", value: "Disclosed related-party market-making agreement with an affiliated trading firm", status: "verified", artifact_verified: true },
      ],
    }, axes);
    const catalog = extractScoringEvidenceCatalog(packet);
    const control = catalog.find((artifact) => artifact.operation === "basicFacts:control");
    const conflict = catalog.find((artifact) => artifact.operation === "basicFacts:conflict_of_interest");

    expect(control?.eligibleAxes).toEqual(expect.arrayContaining(["P3_token_conduct", "P6_transparency_integrity"]));
    expect(conflict?.eligibleAxes).toContain("P6_transparency_integrity");
  });

  it("preserves a lower-priority covered axis before applying the 24-row source cap", () => {
    const axes: AnalystAxis[] = [
      { axis: "I2_portfolio_quality", weight: 25, role: "INVESTOR" },
      { axis: "I3_fund_scale_tier", weight: 15, role: "INVESTOR" },
    ];
    const fundScaleRows = Array.from({ length: 24 }, (_, index) => verifiedFundScaleArtifact({
      title: `Subject closed Fund ${index + 1}`,
      sourceUrl: `https://subject.example/fund-${index + 1}`,
      contentHash: (index + 1).toString(16).padStart(64, "0"),
      sourceContentHash: (index + 40).toString(16).padStart(64, "0"),
      fundVehicle: `Subject Venture Fund ${index + 1}`,
      fundScaleClaimId: `fund_scale_claim_v1_subject_fund_${index + 1}`,
    }));
    const packet = buildScoringEvidencePacket({
      profile: {
        handle: "@subject",
        display_name: "Subject",
        bio: "Investor",
        website: "https://subject.example",
        profile_collection_state: "resolved",
        profile_provider: "twitterapi",
        profile_captured_at: "2026-07-11T12:00:00.000Z",
      },
      sourceArtifacts: [...fundScaleRows, {
        kind: "portfolio_relationship",
        provider: "portfolio-web",
        title: "Subject → Verified Portfolio Company",
        excerpt: "Verified Portfolio Company appears on the subject's official portfolio page.",
        sourceUrl: "https://subject.example/portfolio/verified-company",
        capturedAt: "2026-07-11T12:00:00.000Z",
        contentHash: "c".repeat(64),
        sourceContentHash: "d".repeat(64),
        match: "relationship_confirmed",
        relationship: "invested_in",
        subjectName: "Subject",
        subjectHandle: "@subject",
        projectName: "Verified Portfolio Company",
        sourceClass: "first_party_subject",
        investorEntityName: "Subject",
        investorEntityDomain: "subject.example",
        attribution: "direct_subject",
      }],
    }, axes);
    const parsed = JSON.parse(packet) as { sourceArtifacts: SourceArtifact[] };

    expect(packet.length).toBeLessThanOrEqual(ANALYST_EVIDENCE_MAX_CHARS);
    expect(parsed.sourceArtifacts.length).toBeLessThanOrEqual(24);
    expect(parsed.sourceArtifacts).toContainEqual(expect.objectContaining({
      kind: "portfolio_relationship",
      match: "relationship_confirmed",
    }));
    expect(inspectAnalystScoringPreflight(axes, packet)).toMatchObject({
      state: "ready",
      missingSubstantiveAxes: [],
    });
  });

  it("retains a material project integration when generic press reaches the source cap", () => {
    const axes: AnalystAxis[] = [
      { axis: "P4_backing_and_partners", weight: 14, role: "PROJECT" },
    ];
    const generic = Array.from({ length: 24 }, (_, index) => ({
      kind: "press" as const,
      provider: "google-news" as const,
      title: `Generic project update ${index + 1}`,
      excerpt: "The project published another general market update.",
      sourceUrl: `https://news.example/project-update-${index + 1}`,
      capturedAt: "2026-07-12T12:00:00.000Z",
      contentHash: (index + 1).toString(16).padStart(64, "0"),
      match: "exact_handle" as const,
    }));
    const integration = {
      kind: "press" as const,
      provider: "google-news" as const,
      title: "Securitize, Jump, JupiterExchange launch regulated onchain trading on Solana",
      excerpt: "The three companies launched the regulated trading product together.",
      sourceUrl: "https://news.example/material-integration",
      capturedAt: "2026-07-12T12:00:00.000Z",
      contentHash: "f".repeat(64),
      match: "exact_handle" as const,
    };

    const packet = buildScoringEvidencePacket({ sourceArtifacts: [...generic, integration] }, axes);
    const parsed = JSON.parse(packet) as { sourceArtifacts: SourceArtifact[] };

    expect(parsed.sourceArtifacts.length).toBeLessThanOrEqual(24);
    expect(parsed.sourceArtifacts.length).toBeGreaterThan(0);
    expect(parsed.sourceArtifacts).toContainEqual(expect.objectContaining({
      sourceUrl: "https://news.example/material-integration",
    }));
  });

  it("does not treat generic price news as project product, traction, or transparency evidence", () => {
    const axes: AnalystAxis[] = [
      { axis: "P2_product_substance", weight: 24, role: "PROJECT" },
      { axis: "P5_traction_and_liveness", weight: 14, role: "PROJECT" },
      { axis: "P6_transparency_integrity", weight: 12, role: "PROJECT" },
    ];
    const packet = buildScoringEvidencePacket({
      sourceArtifacts: [{
        kind: "press",
        provider: "google-news",
        title: "Token price rises after broad crypto market move",
        excerpt: "The asset changed price during a volatile trading session.",
        sourceUrl: "https://news.example/generic-price-update",
        capturedAt: "2026-07-12T12:00:00.000Z",
        contentHash: "9".repeat(64),
        match: "exact_handle",
      }],
    }, axes);
    const parsed = JSON.parse(packet) as { sourceArtifacts: SourceArtifact[] };

    expect(parsed.sourceArtifacts).toEqual([]);
    expect(inspectAnalystScoringPreflight(axes, packet)).toMatchObject({
      state: "insufficient_evidence",
      missingSubstantiveAxes: axes.map(({ axis }) => axis),
    });
  });

  it("does not promote denied or rumored partnerships as project backing evidence", () => {
    const axes: AnalystAxis[] = [
      { axis: "P4_backing_and_partners", weight: 14, role: "PROJECT" },
    ];
    const generic = Array.from({ length: 23 }, (_, index) => ({
      kind: "press" as const,
      provider: "google-news" as const,
      title: `Generic project update ${index + 1}`,
      excerpt: "The project published another general market update.",
      sourceUrl: `https://news.example/generic-${index + 1}`,
      capturedAt: "2026-07-12T12:00:00.000Z",
      contentHash: (index + 1).toString(16).padStart(64, "0"),
      match: "exact_handle" as const,
    }));
    const confirmedLaunch = {
      ...generic[0],
      title: "Securitize, Jump, JupiterExchange launch regulated trading on Solana",
      excerpt: "The three companies launched the product together.",
      sourceUrl: "https://news.example/confirmed-launch",
      contentHash: "e".repeat(64),
    };
    const denial = {
      ...generic[0],
      title: "Protocol denies rumored partnership with Major Exchange",
      excerpt: "The team said the alleged integration is false and no partnership exists.",
      sourceUrl: "https://news.example/partnership-denial",
      contentHash: "f".repeat(64),
    };
    const rumor = {
      ...generic[0],
      title: "Rumor: Protocol partnership with Major Exchange",
      excerpt: "An unconfirmed post alleged the companies may be working together.",
      sourceUrl: "https://news.example/partnership-rumor",
      contentHash: "d".repeat(64),
    };

    const parsed = JSON.parse(buildScoringEvidencePacket({
      sourceArtifacts: [...generic, confirmedLaunch, denial, rumor],
    }, axes)) as { sourceArtifacts: SourceArtifact[] };

    expect(parsed.sourceArtifacts.length).toBeLessThanOrEqual(24);
    expect(parsed.sourceArtifacts.length).toBeGreaterThan(0);
    expect(parsed.sourceArtifacts).toContainEqual(expect.objectContaining({
      sourceUrl: "https://news.example/confirmed-launch",
    }));
    expect(parsed.sourceArtifacts).not.toContainEqual(expect.objectContaining({
      sourceUrl: "https://news.example/partnership-denial",
    }));
    expect(parsed.sourceArtifacts).not.toContainEqual(expect.objectContaining({
      sourceUrl: "https://news.example/partnership-rumor",
    }));
    for (const speculative of [denial, rumor]) {
      const underCap = JSON.parse(buildScoringEvidencePacket({
        sourceArtifacts: [speculative],
      }, axes)) as { sourceArtifacts: SourceArtifact[] };
      expect(underCap.sourceArtifacts).toEqual([]);
    }
    const presentTense = {
      ...generic[0],
      title: "Jupiter partners with Securitize on regulated trading",
      excerpt: "Jupiter invests engineering resources in the shared integration.",
      sourceUrl: "https://news.example/present-tense-partnership",
      contentHash: "c".repeat(64),
    };
    const affirmative = JSON.parse(buildScoringEvidencePacket({
      sourceArtifacts: [presentTense],
    }, axes)) as { sourceArtifacts: SourceArtifact[] };
    expect(affirmative.sourceArtifacts).toContainEqual(expect.objectContaining({
      sourceUrl: "https://news.example/present-tense-partnership",
    }));
  });

  it("uses an existing unavailable check as the gap artifact instead of synthesizing a duplicate", () => {
    const trackRecordOnly: AnalystAxis[] = [{ axis: "I2_portfolio_quality", weight: 25, role: "INVESTOR" }];
    const packet = buildScoringEvidencePacket({
      profile: { handle: "@subject", profile_collection_state: "resolved", profile_provider: "twitterapi" },
      profileAuthenticity: {
        provider: "claude-vision",
        capturedAt: "2026-07-11T12:00:00.000Z",
        classification: "real_candid",
        flag: false,
        tells: [],
        note: "Review lead only.",
      },
      checkOutcomes: [{
        checkId: "vc-portfolio-track-record",
        status: "unavailable",
        note: "Portfolio provider did not return evidence.",
        provider: "portfolio-web",
      }],
    }, trackRecordOnly);
    const parsed = JSON.parse(packet);
    const frozenCatalog = extractScoringEvidenceCatalog(packet);

    expect(parsed).not.toHaveProperty("profileAuthenticity");
    expect(parsed.axisGaps).toEqual([]);
    expect(frozenCatalog).toContainEqual(expect.objectContaining({
      section: "checkOutcomes",
      verification: "unavailable",
      eligibleAxes: ["I2_portfolio_quality"],
    }));
  });

  it("routes a frozen investment relationship only to portfolio quality", () => {
    const axes: AnalystAxis[] = [
      { axis: "F2_track_record", weight: 28, role: "FOUNDER" },
      { axis: "I2_portfolio_quality", weight: 25, role: "INVESTOR" },
      { axis: "I3_fund_scale_tier", weight: 15, role: "INVESTOR" },
    ];
    const packet = buildScoringEvidencePacket({
      sourceArtifacts: [{
        kind: "portfolio_relationship",
        provider: "portfolio-web",
        title: "Paradigm → Acme Protocol",
        sourceUrl: "https://paradigm.xyz/portfolio/acme",
        capturedAt: "2026-07-11T12:00:00.000Z",
        contentHash: "a".repeat(64),
        sourceContentHash: "b".repeat(64),
        match: "relationship_confirmed",
        relationship: "invested_in",
        subjectName: "Paradigm",
        projectName: "Acme Protocol",
        sourceClass: "first_party_subject",
      }],
    }, axes);
    const parsed = JSON.parse(packet);
    const relationship = extractScoringEvidenceCatalog(packet).find((artifact) =>
      artifact.section === "sourceArtifacts" && artifact.operation === "sourceArtifacts:portfolio_relationship",
    );

    expect(relationship).toMatchObject({
      verification: "verified",
      eligibleAxes: ["I2_portfolio_quality"],
      sourceUrl: "https://paradigm.xyz/portfolio/acme",
    });
    expect(parsed.axisGaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ axis: "F2_track_record", status: "unavailable" }),
      expect.objectContaining({ axis: "I3_fund_scale_tier", status: "unavailable" }),
    ]));
  });

  it("keeps reported-only portfolio relationships outside the scoring packet", () => {
    const axes: AnalystAxis[] = [
      { axis: "I2_portfolio_quality", weight: 25, role: "INVESTOR" },
    ];
    const packet = buildScoringEvidencePacket({
      sourceArtifacts: [{
        kind: "portfolio_relationship",
        provider: "portfolio-web",
        title: "Paradigm → Acme Protocol",
        sourceUrl: "https://techcrunch.com/acme-round",
        capturedAt: "2026-07-11T12:00:00.000Z",
        contentHash: "a".repeat(64),
        sourceContentHash: "b".repeat(64),
        match: "candidate",
        relationship: "invested_in",
        subjectName: "Paradigm",
        projectName: "Acme Protocol",
        sourceClass: "independent_press",
      }],
    }, axes);
    const parsed = JSON.parse(packet);

    expect(parsed.sourceArtifacts).toEqual([]);
    expect(extractScoringEvidenceCatalog(packet)).not.toContainEqual(expect.objectContaining({
      operation: "sourceArtifacts:portfolio_relationship",
    }));
    expect(parsed.axisGaps).toEqual([
      expect.objectContaining({ axis: "I2_portfolio_quality", status: "unavailable" }),
    ]);
  });

  it("keeps an unfetched fund-size headline outside fund-scale scoring", () => {
    const axes: AnalystAxis[] = [
      { axis: "I2_portfolio_quality", weight: 25, role: "INVESTOR" },
      { axis: "I3_fund_scale_tier", weight: 15, role: "INVESTOR" },
    ];
    const packet = buildScoringEvidencePacket({
      sourceArtifacts: [{
        kind: "press",
        provider: "google-news",
        title: "Paradigm raises $850 million for its new fund",
        sourceUrl: "https://example.com/paradigm-fund",
        capturedAt: "2026-07-11T12:00:00.000Z",
        contentHash: "c".repeat(64),
        match: "exact_name",
      }],
    }, axes);
    const press = extractScoringEvidenceCatalog(packet).find((artifact) => artifact.section === "sourceArtifacts");
    expect(press).toBeUndefined();
    expect(JSON.parse(packet).axisGaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ axis: "I2_portfolio_quality", status: "unavailable" }),
      expect.objectContaining({ axis: "I3_fund_scale_tier", status: "unavailable" }),
    ]));
  });

  it("routes only a fetched, content-addressed fund-scale artifact to I3", () => {
    const axes: AnalystAxis[] = [
      { axis: "I3_fund_scale_tier", weight: 15, role: "INVESTOR" },
    ];
    const packet = buildScoringEvidencePacket({
      sourceArtifacts: [verifiedFundScaleArtifact()],
    }, axes);
    expect(extractScoringEvidenceCatalog(packet)).toContainEqual(expect.objectContaining({
      operation: "sourceArtifacts:fund_scale",
      eligibleAxes: ["I3_fund_scale_tier"],
      verification: "verified",
    }));
    expect(JSON.parse(packet).axisGaps).toEqual([]);
  });

  it("does not let a singleton press artifact impersonate two-source corroboration", () => {
    const axes: AnalystAxis[] = [{ axis: "I3_fund_scale_tier", weight: 15, role: "INVESTOR" }];
    const packet = buildScoringEvidencePacket({
      sourceArtifacts: [verifiedFundScaleArtifact({
        sourceUrl: "https://reuters.com/markets/subject-fund",
        sourceClass: "independent_press",
        fundScaleBasis: "press_corroborated",
        fundScaleSourceCount: 2,
      })],
    }, axes);
    expect(JSON.parse(packet).sourceArtifacts).toEqual([]);
    expect(JSON.parse(packet).axisGaps).toEqual([
      expect.objectContaining({ axis: "I3_fund_scale_tier", status: "unavailable" }),
    ]);
  });

  it("rejects a credential-bearing fund source instead of laundering it during packet sanitization", () => {
    const axes: AnalystAxis[] = [{ axis: "I3_fund_scale_tier", weight: 15, role: "INVESTOR" }];
    const packet = buildScoringEvidencePacket({
      sourceArtifacts: [verifiedFundScaleArtifact({ sourceUrl: "https://subject.example/fund-size?token=secret" })],
    }, axes);
    expect(JSON.parse(packet).sourceArtifacts).toEqual([]);
    expect(JSON.parse(packet).axisGaps).toEqual([
      expect.objectContaining({ axis: "I3_fund_scale_tier", status: "unavailable" }),
    ]);
  });

  it("retains two compatible, distinct press artifacts for the same canonical scale claim", () => {
    const axes: AnalystAxis[] = [{ axis: "I3_fund_scale_tier", weight: 15, role: "INVESTOR" }];
    const first = verifiedFundScaleArtifact({
      sourceUrl: "https://reuters.com/markets/subject-fund",
      sourceClass: "independent_press",
      fundScaleBasis: "press_corroborated",
      fundScaleSourceCount: 2,
    });
    const second = verifiedFundScaleArtifact({
      sourceUrl: "https://ft.com/content/subject-fund",
      sourceClass: "independent_press",
      fundScaleBasis: "press_corroborated",
      fundScaleSourceCount: 2,
      contentHash: "c".repeat(64),
      sourceContentHash: "d".repeat(64),
      excerpt: "The Financial Times reports a completed $500 million close for Subject Venture Fund I.",
    });
    const packet = buildScoringEvidencePacket({ sourceArtifacts: [first, second] }, axes);
    const scaleEvidence = extractScoringEvidenceCatalog(packet).filter((artifact) => artifact.operation === "sourceArtifacts:fund_scale");
    expect(scaleEvidence).toHaveLength(2);
    expect(scaleEvidence.every((artifact) => artifact.verification === "verified")).toBe(true);
    expect(JSON.parse(packet).axisGaps).toEqual([]);
  });

  it("does not retain a press root when its only peer fails the full corroboration contract", () => {
    const axes: AnalystAxis[] = [{ axis: "I3_fund_scale_tier", weight: 15, role: "INVESTOR" }];
    const root = verifiedFundScaleArtifact({
      sourceUrl: "https://reuters.com/markets/subject-fund",
      sourceClass: "independent_press",
      fundScaleBasis: "press_corroborated",
      fundScaleSourceCount: 2,
    });
    const incompletePeer = verifiedFundScaleArtifact({
      sourceUrl: "https://ft.com/content/subject-fund",
      sourceClass: "independent_press",
      fundScaleBasis: "press_corroborated",
      fundScaleSourceCount: undefined,
      contentHash: "c".repeat(64),
      sourceContentHash: "d".repeat(64),
      excerpt: "The Financial Times reports a completed $500 million close for Subject Venture Fund I.",
    });
    const packet = buildScoringEvidencePacket({ sourceArtifacts: [root, incompletePeer] }, axes);
    expect(JSON.parse(packet).sourceArtifacts).toEqual([]);
    expect(JSON.parse(packet).axisGaps).toHaveLength(1);
  });

  it("prioritizes fund-scale evidence before the source-artifact packet cap", () => {
    const axes: AnalystAxis[] = [{ axis: "I3_fund_scale_tier", weight: 15, role: "INVESTOR" }];
    const generic = Array.from({ length: 24 }, (_, index) => ({
      kind: "press" as const,
      provider: "google-news" as const,
      title: `Generic press ${index}`,
      sourceUrl: `https://example.com/press/${index}`,
      capturedAt: "2026-07-11T12:00:00.000Z",
      contentHash: `${index.toString(16).padStart(2, "0")}${"a".repeat(62)}`,
      match: "exact_name" as const,
    }));
    const packet = buildScoringEvidencePacket({ sourceArtifacts: [...generic, verifiedFundScaleArtifact()] }, axes);
    expect(extractScoringEvidenceCatalog(packet)).toContainEqual(expect.objectContaining({
      operation: "sourceArtifacts:fund_scale",
      eligibleAxes: ["I3_fund_scale_tier"],
    }));
    expect(JSON.parse(packet).axisGaps).toEqual([]);
  });

  it("requires an exact, sanitized current-profile source before affiliated fund scale can score", () => {
    const axes: AnalystAxis[] = [{ axis: "I3_fund_scale_tier", weight: 15, role: "INVESTOR" }];
    const affiliated = verifiedFundScaleArtifact({
      subjectName: "Alice Investor",
      subjectHandle: "@alice",
      fundName: "Subject Capital",
      investorEntityName: "Subject Capital",
      sourceUrl: "https://www.sec.gov/Archives/edgar/data/123456/000012345626000001/adv.html",
      fundVehicle: undefined,
      fundScaleMetric: "regulatory_aum",
      fundScaleBasis: "regulatory",
      fundScaleTemporalState: "current",
      fundScaleAsOf: "2026-06-30T00:00:00.000Z",
      attribution: "affiliated_fund",
      sourceClass: "public_primary",
      attributionSourceUrl: "https://x.com/alice",
      attributionSourceContentHash: "e".repeat(64),
      attributionCapturedAt: "2026-07-11T11:58:00.000Z",
      attributionSourceKind: "provider_profile",
    });
    expect(JSON.parse(buildScoringEvidencePacket({ sourceArtifacts: [affiliated] }, axes)).axisGaps).toEqual([]);
    const unsafe = { ...affiliated, attributionSourceUrl: "https://x.com/alice?token=secret" };
    expect(JSON.parse(buildScoringEvidencePacket({ sourceArtifacts: [unsafe] }, axes)).sourceArtifacts).toEqual([]);
  });

  it("retains frozen official fund-domain proof and rejects credential-bearing proof URLs", () => {
    const axes: AnalystAxis[] = [{ axis: "I3_fund_scale_tier", weight: 15, role: "INVESTOR" }];
    const profile = {
      handle: "@alice",
      display_name: "Alice Investor",
      bio: "Research Partner @subjectcapital",
      website: "https://alice.example",
      profile_collection_state: "resolved",
      profile_provider: "twitterapi",
      profile_captured_at: "2026-07-11T11:58:00.000Z",
    };
    const affiliated = verifiedFundScaleArtifact({
      subjectName: "Alice Investor",
      subjectHandle: "@alice",
      fundName: "Subject Capital",
      investorEntityName: "Subject Capital",
      investorEntityHandle: "@subjectcapital",
      investorEntityDomain: "subject.example",
      sourceUrl: "https://subject.example/fund-size",
      sourceClass: "first_party_investor",
      attribution: "affiliated_fund",
      attributionSourceUrl: "https://x.com/alice",
      attributionSourceContentHash: "e".repeat(64),
      attributionCapturedAt: "2026-07-11T11:58:00.000Z",
      attributionSourceKind: "provider_profile",
      investorDomainSourceUrl: "https://x.com/subjectcapital",
      investorDomainSourceContentHash: "f".repeat(64),
      investorDomainCapturedAt: "2026-07-11T11:57:00.000Z",
      investorDomainSourceKind: "provider_profile",
      investorDomainProfileName: "Subject Capital",
      investorDomainProfileWebsite: "https://subject.example/",
    });
    const packet = JSON.parse(buildScoringEvidencePacket({ profile, sourceArtifacts: [affiliated] }, axes));

    expect(packet.sourceArtifacts).toEqual([expect.objectContaining({
      investorDomainSourceUrl: "https://x.com/subjectcapital",
      investorDomainSourceContentHash: "f".repeat(64),
      investorDomainSourceKind: "provider_profile",
      investorDomainProfileName: "Subject Capital",
      investorDomainProfileWebsite: "https://subject.example/",
    })]);
    expect(packet.axisGaps).toEqual([]);

    const unsafe = {
      ...affiliated,
      investorDomainSourceUrl: "https://x.com/subjectcapital?token=secret",
    };
    expect(JSON.parse(buildScoringEvidencePacket({ profile, sourceArtifacts: [unsafe] }, axes)).sourceArtifacts).toEqual([]);
    const unsafeProfileWebsite = {
      ...affiliated,
      investorDomainProfileWebsite: "https://subject.example?access_token=secret",
    };
    const unsafeWebsitePacket = buildScoringEvidencePacket({
      profile,
      sourceArtifacts: [unsafeProfileWebsite],
    }, axes);
    expect(unsafeWebsitePacket).not.toContain("access_token");
    expect(JSON.parse(unsafeWebsitePacket).sourceArtifacts).toEqual([]);
  });

  it("binds affiliated fund scale to the audited provider profile and its current bio", () => {
    const axes: AnalystAxis[] = [{ axis: "I3_fund_scale_tier", weight: 15, role: "INVESTOR" }];
    const profile = {
      handle: "@victim",
      display_name: "Victim Researcher",
      bio: "Independent researcher; no fund role",
      website: "https://real.example",
      profile_collection_state: "resolved",
      profile_provider: "twitterapi",
      profile_captured_at: "2026-07-11T11:58:00.000Z",
    };
    const affiliated = verifiedFundScaleArtifact({
      subjectName: "Victim Researcher",
      subjectHandle: "@victim",
      fundName: "Subject Capital",
      investorEntityName: "Subject Capital",
      sourceUrl: "https://www.sec.gov/Archives/edgar/data/123456/000012345626000001/adv.html",
      fundVehicle: undefined,
      fundScaleMetric: "regulatory_aum",
      fundScaleBasis: "regulatory",
      fundScaleTemporalState: "current",
      fundScaleAsOf: "2026-06-30T00:00:00.000Z",
      attribution: "affiliated_fund",
      sourceClass: "public_primary",
      attributionSourceUrl: "https://x.com/victim",
      attributionSourceContentHash: "e".repeat(64),
      attributionCapturedAt: "2026-07-11T11:58:00.000Z",
      attributionSourceKind: "provider_profile",
    });
    const rejected = JSON.parse(buildScoringEvidencePacket({ profile, sourceArtifacts: [affiliated] }, axes));
    expect(rejected.sourceArtifacts).toEqual([]);
    expect(rejected.axisGaps).toHaveLength(1);

    const accepted = JSON.parse(buildScoringEvidencePacket({
      profile: { ...profile, bio: "Research Partner at Subject Capital" },
      sourceArtifacts: [affiliated],
    }, axes));
    expect(accepted.sourceArtifacts).toHaveLength(1);
    expect(accepted.axisGaps).toEqual([]);
  });

  it("binds a direct first-party fund source to the audited profile website", () => {
    const axes: AnalystAxis[] = [{ axis: "I3_fund_scale_tier", weight: 15, role: "INVESTOR" }];
    const profile = {
      handle: "@subject",
      display_name: "Subject",
      bio: "Investment manager",
      website: "https://real.example",
      profile_collection_state: "resolved",
      profile_provider: "twitterapi",
      profile_captured_at: "2026-07-11T11:58:00.000Z",
    };
    const forged = verifiedFundScaleArtifact({
      sourceUrl: "https://attacker.com/fund",
      investorEntityDomain: "attacker.com",
    });
    const packet = JSON.parse(buildScoringEvidencePacket({ profile, sourceArtifacts: [forged] }, axes));
    expect(packet.sourceArtifacts).toEqual([]);
    expect(packet.axisGaps).toHaveLength(1);
  });

  it.each([
    ["provider", { provider: "portfolio-web" }],
    ["sourceUrl", { sourceUrl: undefined }],
    ["sourceContentHash", { sourceContentHash: undefined }],
    ["fundName", { fundName: undefined }],
    ["fundSizeUsd", { fundSizeUsd: Number.NaN }],
    ["investorEntityName", { investorEntityName: undefined }],
    ["subjectName", { subjectName: undefined }],
    ["attribution", { attribution: undefined }],
    ["sourceClass", { sourceClass: undefined }],
    ["investorEntityDomain", { investorEntityDomain: undefined }],
    ["fundScaleMetric", { fundScaleMetric: undefined }],
    ["fundAmountQualifier", { fundAmountQualifier: undefined }],
    ["fundScaleBasis", { fundScaleBasis: undefined }],
    ["fundScaleTemporalState", { fundScaleTemporalState: undefined }],
  ] as const)("keeps a malformed confirmed fund-scale artifact out of I3 when %s is invalid", (_field, overrides) => {
    const axes: AnalystAxis[] = [{ axis: "I3_fund_scale_tier", weight: 15, role: "INVESTOR" }];
    const packet = buildScoringEvidencePacket({
      sourceArtifacts: [verifiedFundScaleArtifact(overrides as Partial<SourceArtifact>)],
    }, axes);
    expect(JSON.parse(packet).sourceArtifacts).toEqual([]);
    expect(JSON.parse(packet).axisGaps).toEqual([
      expect.objectContaining({ axis: "I3_fund_scale_tier", status: "unavailable" }),
    ]);
  });

  it("does not route an identity-unbound fund-size candidate into scoring", () => {
    const axes: AnalystAxis[] = [
      { axis: "I3_fund_scale_tier", weight: 15, role: "INVESTOR" },
    ];
    const packet = buildScoringEvidencePacket({
      sourceArtifacts: [{
        kind: "press",
        provider: "google-news",
        title: "Candidate manager raises $850 million for a new fund",
        sourceUrl: "https://example.com/candidate-fund",
        capturedAt: "2026-07-11T12:00:00.000Z",
        contentHash: "c".repeat(64),
        match: "candidate",
      }],
    }, axes);

    expect(JSON.parse(packet).sourceArtifacts).toEqual([]);
    expect(JSON.parse(packet).axisGaps).toEqual([
      expect.objectContaining({ axis: "I3_fund_scale_tier", status: "unavailable" }),
    ]);
  });

  it("catalogs only corroborated client, associate, team, and venture-team records", () => {
    const expandedCatalog: AnalystAxis[] = [
      { axis: "AG2_client_outcomes", weight: 25, role: "AGENCY" },
      { axis: "F6_network_quality", weight: 12, role: "FOUNDER" },
      { axis: "F2_track_record", weight: 28, role: "FOUNDER" },
    ];
    const packet = buildScoringEvidencePacket({
      profile: { handle: "@subject", profile_collection_state: "resolved", profile_provider: "twitterapi" },
      clientEngagements: [
        { client_name: "Verified Client", service_type: "growth", artifact_verified: true },
        { client_name: "MODEL_CLIENT_EXCLUDED", evidence_origin: "model_lead", artifact_verified: false },
      ],
      team: [
        { name: "Verified Leader", role: "CEO", provider: "team-page", evidence_origin: "deterministic", artifact_verified: true },
        { name: "MODEL_TEAM_EXCLUDED", role: "CTO", provider: "grok", evidence_origin: "model_lead", artifact_verified: false },
      ],
      associates: [
        { associate_handle: "@peer", relation: "co-builder", provider: "github", evidence_origin: "deterministic", artifact_verified: true },
        { associate_handle: "@model_peer", relation: "possible collaborator", provider: "grok", evidence_origin: "model_lead", artifact_verified: false },
      ],
      ventureTeams: [
        { key: "venture:one", name: "Venture One", people: [{ name: "Named Builder" }], provider: "team-page", evidence_origin: "deterministic", artifact_verified: true },
        { key: "venture:model", name: "MODEL_VENTURE_TEAM_EXCLUDED", people: [{ name: "Guessed Builder" }], provider: "grok", evidence_origin: "model_lead", artifact_verified: false },
      ],
    }, expandedCatalog);
    const parsed = JSON.parse(packet);
    const artifacts = extractScoringEvidenceCatalog(packet);

    expect(parsed.clientEngagements).toHaveLength(1);
    expect(packet).not.toContain("MODEL_CLIENT_EXCLUDED");
    expect(packet).not.toContain("MODEL_TEAM_EXCLUDED");
    expect(packet).not.toContain("model_peer");
    expect(packet).not.toContain("MODEL_VENTURE_TEAM_EXCLUDED");
    expect(artifacts.find((artifact) => artifact.section === "clientEngagements")?.eligibleAxes).toEqual(["AG2_client_outcomes"]);
    expect(artifacts.find((artifact) => artifact.section === "team")?.provider).toBe("team-page");
    expect(artifacts.find((artifact) => artifact.section === "associates")?.eligibleAxes).toEqual(["F6_network_quality"]);
    expect(artifacts.find((artifact) => artifact.section === "associates")?.provider).toBe("github");
    expect(artifacts.find((artifact) => artifact.section === "ventureTeams")?.eligibleAxes).toEqual(["F6_network_quality", "F2_track_record"]);
  });

  it("routes frozen source artifacts by kind instead of making every source eligible for every axis", () => {
    const axes: AnalystAxis[] = [
      { axis: "F1_identity_verifiability", weight: 12, role: "FOUNDER" },
      { axis: "F2_track_record", weight: 28, role: "FOUNDER" },
      { axis: "F5_reputation_integrity", weight: 18, role: "FOUNDER" },
      { axis: "K4_onchain_conduct", weight: 20, role: "KOL" },
      { axis: "AG3_service_integrity", weight: 25, role: "AGENCY" },
    ];
    const packet = buildScoringEvidencePacket({
      profile: { handle: "@subject", profile_collection_state: "resolved", profile_provider: "twitterapi" },
      sourceArtifacts: [
        { kind: "press", provider: "google-news", title: "Press history", sourceUrl: "https://example.com/press", match: "observed" },
        { kind: "profile_photo", provider: "claude-vision", title: "Photo screen", contentHash: "a".repeat(64), match: "observed" },
        { kind: "legal_case", provider: "courtlistener", title: "Legal screen", sourceUrl: "https://example.com/legal", match: "observed" },
        { kind: "trust_graph", provider: "argus-graph", title: "Graph tie", contentHash: "b".repeat(64), match: "risk_signal" },
        { kind: "unknown", provider: "unknown", title: "Unclassified source", sourceUrl: "https://example.com/unknown" },
      ],
    }, axes);
    const parsed = JSON.parse(packet);
    const frozen = extractScoringEvidenceCatalog(packet);
    const source = (title: string) => frozen.find((artifact) => artifact.title === title)!;

    expect(source("Press history").eligibleAxes).toEqual(["F2_track_record", "F5_reputation_integrity"]);
    expect(source("Press history").eligibleAxes).not.toEqual(expect.arrayContaining(["K4_onchain_conduct", "AG3_service_integrity"]));
    expect(frozen.find((artifact) => artifact.title === "Photo screen")).toBeUndefined();
    expect(parsed).not.toHaveProperty("profileAuthenticity");
    expect(parsed.sourceArtifacts).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Photo screen" }),
    ]));
    expect(source("Legal screen").eligibleAxes).toEqual(["F1_identity_verifiability", "F5_reputation_integrity"]);
    expect(source("Graph tie").eligibleAxes).toEqual(["F5_reputation_integrity", "K4_onchain_conduct", "AG3_service_integrity"]);
    expect(frozen.find((artifact) => artifact.title === "Unclassified source")).toBeUndefined();
  });

  it("treats incomplete and empty-clear trust graph records as coverage only", () => {
    const axes: AnalystAxis[] = [{ axis: "F5_reputation_integrity", weight: 18, role: "FOUNDER" }];
    const incomplete = extractScoringEvidenceCatalog(buildScoringEvidencePacket({
      trustGraphScreen: {
        provider: "argus-graph",
        status: "incomplete",
        sourceContentHash: "a".repeat(64),
        connections: [{ qualified: false, ties: [{ key: "email:x@example.com" }] }],
      },
      sourceArtifacts: [{
        kind: "trust_graph",
        provider: "argus-graph",
        title: "Incomplete graph",
        contentHash: "a".repeat(64),
        sourceContentHash: "a".repeat(64),
        match: "observed",
        coverageState: "unavailable",
      }],
    }, axes));
    const clear = extractScoringEvidenceCatalog(buildScoringEvidencePacket({
      trustGraphScreen: {
        provider: "argus-graph",
        status: "clear",
        sourceContentHash: "b".repeat(64),
        qualifiedContributionCount: 0,
        connections: [],
      },
      sourceArtifacts: [{
        kind: "trust_graph",
        provider: "argus-graph",
        title: "Clear graph",
        contentHash: "b".repeat(64),
        sourceContentHash: "b".repeat(64),
        match: "screened_clear",
      }],
    }, axes));

    expect(incomplete.filter((artifact) => artifact.section === "trustGraphScreen" || artifact.section === "sourceArtifacts")
      .every((artifact) => artifact.verification === "unavailable")).toBe(true);
    expect(clear.filter((artifact) => artifact.section === "trustGraphScreen" || artifact.section === "sourceArtifacts")
      .every((artifact) => artifact.verification === "checked_empty")).toBe(true);
  });

  it("admits only exact qualified trust graph risk predicates as substantive", () => {
    const axes: AnalystAxis[] = [{ axis: "F5_reputation_integrity", weight: 18, role: "FOUNDER" }];
    const frozen = extractScoringEvidenceCatalog(buildScoringEvidencePacket({
      trustGraphScreen: {
        provider: "argus-graph",
        status: "risk",
        sourceContentHash: "c".repeat(64),
        connections: [{ qualified: true, ties: [{ key: "email:x@example.com", strength: "hard" }] }],
      },
      sourceArtifacts: [{
        kind: "trust_graph",
        provider: "argus-graph",
        title: "Qualified graph risk",
        contentHash: "c".repeat(64),
        sourceContentHash: "c".repeat(64),
        match: "risk_signal",
      }],
    }, axes));

    expect(frozen.filter((artifact) => artifact.section === "trustGraphScreen" || artifact.section === "sourceArtifacts")
      .every((artifact) => artifact.verification === "verified")).toBe(true);
  });

  it("requires positive trusted provenance for every scorer finding", () => {
    const axes: AnalystAxis[] = [{ axis: "P3_token_conduct", weight: 17, role: "PROJECT" }];
    const finding = (claim: string, provenance: Record<string, unknown>) => ({
      finding_type: "TokenCollapse",
      claim,
      source_url: `https://example.com/${claim}`,
      source_author: "dexscreener",
      verification_status: "Verified",
      independent_source_count: 1,
      polarity: -1,
      ...provenance,
    });
    const packet = buildScoringEvidencePacket({
      findings: [
        finding("model", { evidence_origin: "model_lead", artifact_verified: true }),
        finding("explicit-false", { evidence_origin: "deterministic", artifact_verified: false }),
        finding("legacy-unstamped", {}),
        finding("trusted", { evidence_origin: "deterministic", artifact_verified: true }),
      ],
    }, axes);
    const parsed = JSON.parse(packet);

    expect(parsed.findings).toEqual([expect.objectContaining({ claim: "trusted" })]);
    expect(packet).not.toContain("explicit-false");
    expect(packet).not.toContain("legacy-unstamped");
    expect(packet).not.toContain("model");
  });

  it("routes findings by exact type and rejects cross-domain identity citations", () => {
    const axes: AnalystAxis[] = [
      { axis: "P1_team_and_identity", weight: 18, role: "PROJECT" },
      { axis: "P3_token_conduct", weight: 17, role: "PROJECT" },
    ];
    const packet = buildScoringEvidencePacket({
      findings: [{
        finding_type: "TokenCollapse",
        claim: "The attributed token collapsed after launch.",
        source_url: "https://dexscreener.com/token/example",
        source_author: "dexscreener",
        verification_status: "Verified",
        independent_source_count: 1,
        polarity: -1,
        evidence_origin: "deterministic",
        artifact_verified: true,
      }],
    }, axes);
    const frozen = extractScoringEvidenceCatalog(packet);
    const collapse = frozen.find((artifact) => artifact.section === "findings")!;

    expect(collapse.eligibleAxes).toEqual(["P3_token_conduct"]);
    expect(collapse.provider).toBe("dexscreener");
    expect(validateAnalystVerdict({
      axes: [
        validAxis("P1_team_and_identity", 18, collapse.artifactId),
        validAxis("P3_token_conduct", 5, collapse.artifactId),
      ],
      headline: "Invalid cross-domain citation",
      identity_note: "Identity unresolved",
    }, axes, frozen)).toBeNull();
  });

  it("routes verified basic facts narrowly and retains their fetched source proof", () => {
    const axes: AnalystAxis[] = [
      { axis: "P1_team_and_identity", weight: 18, role: "PROJECT" },
      { axis: "P3_token_conduct", weight: 17, role: "PROJECT" },
      { axis: "P6_transparency_integrity", weight: 16, role: "PROJECT" },
    ];
    const founderExcerpt = "Jupiter was co-founded by Meow, who continues to lead the project.";
    const governanceExcerpt = "Jupiter governance uses the JUP token for community voting on proposals.";
    const packet = buildScoringEvidencePacket({
      basicFacts: [
        {
          factId: "basic_fact_founder_meow",
          subjectKey: "jupiter",
          predicate: "founder",
          value: "Meow",
          normalizedValue: "meow",
          status: "verified",
          critical: true,
          sources: [{
            url: "https://docs.jup.ag/about/team",
            title: "Jupiter team",
            sourceClass: "official_subject",
            relation: "supports",
            excerpt: founderExcerpt,
            contentHash: "a".repeat(64),
            capturedAt: "2026-07-12T20:00:00.000Z",
            provider: "public-web",
            artifactVerified: true,
          }],
          evidence_origin: "deterministic",
          artifact_verified: true,
          provider: "public-web",
          discoveryProvider: "claude-web-search",
        },
        {
          factId: "basic_fact_governance_jup",
          subjectKey: "jupiter",
          predicate: "governance",
          value: "JUP token voting",
          normalizedValue: "jup token voting",
          status: "corroborated",
          critical: true,
          sources: [{
            url: "https://vote.jup.ag/",
            title: "Jupiter governance",
            sourceClass: "official_subject",
            relation: "supports",
            excerpt: governanceExcerpt,
            contentHash: "b".repeat(64),
            capturedAt: "2026-07-12T20:01:00.000Z",
            provider: "public-web",
            artifactVerified: true,
          }],
          evidence_origin: "deterministic",
          artifact_verified: true,
          provider: "public-web",
          discoveryProvider: "grok",
        },
      ],
    }, axes);
    const parsed = JSON.parse(packet) as {
      basicFacts: Array<{ sources: Array<{ url: string; excerpt: string }> }>;
    };
    const frozen = extractScoringEvidenceCatalog(packet)
      .filter((artifact) => artifact.section === "basicFacts");
    const founder = frozen.find((artifact) => artifact.operation === "basicFacts:founder" && artifact.title === "Meow");
    const governance = frozen.find((artifact) => artifact.title === "JUP token voting");

    expect(parsed.basicFacts[0].sources[0]).toMatchObject({
      url: "https://docs.jup.ag/about/team",
      excerpt: founderExcerpt,
    });
    expect(founder).toMatchObject({
      provider: "public-web",
      excerpt: founderExcerpt,
      sourceUrl: "https://docs.jup.ag/about/team",
      eligibleAxes: ["P1_team_and_identity"],
      verification: "verified",
    });
    expect(governance).toMatchObject({
      excerpt: governanceExcerpt,
      sourceUrl: "https://vote.jup.ag/",
      eligibleAxes: ["P3_token_conduct", "P6_transparency_integrity"],
      verification: "verified",
    });
    // Verified governance disclosure keeps P3 scoreable for a tokenless
    // packet instead of abstaining the entire axis set.
    expect(inspectAnalystScoringPreflight(axes, packet)).toEqual({
      state: "ready",
      requestedAxisCount: 3,
      evidenceArtifactCount: 2,
      missingSubstantiveAxes: [],
      unsupportedAxes: [],
    });
  });

  it("routes verified founder facts narrowly without treating one backer fact as repeat backing", () => {
    const axes: AnalystAxis[] = [
      { axis: "F1_identity_verifiability", weight: 12, role: "FOUNDER" },
      { axis: "F2_track_record", weight: 28, role: "FOUNDER" },
      { axis: "F3_repeat_backing", weight: 15, role: "FOUNDER" },
      { axis: "F4_build_substance", weight: 15, role: "FOUNDER" },
      { axis: "F5_reputation_integrity", weight: 18, role: "FOUNDER" },
      { axis: "F6_network_quality", weight: 12, role: "FOUNDER" },
    ];
    const fact = (predicate: string, value: string) => ({
      factId: `basic_fact_${predicate}_${value.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
      subjectKey: "famous-founder",
      predicate,
      value,
      normalizedValue: value.toLowerCase(),
      status: "verified",
      critical: true,
      sources: [{
        url: `https://example.com/${predicate}`,
        title: `${predicate} source`,
        sourceClass: "official_subject",
        relation: "supports",
        excerpt: `${value} is confirmed by the cited source.`,
        contentHash: "f".repeat(64),
        capturedAt: "2026-07-13T12:00:00.000Z",
        provider: "public-web",
        artifactVerified: true,
      }],
      evidence_origin: "deterministic",
      artifact_verified: true,
      provider: "public-web",
    });
    const packet = buildScoringEvidencePacket({
      basicFacts: [
        fact("official_identity", "Verified founder identity"),
        fact("current_role", "CEO at Acme"),
        fact("prior_role", "Previously engineering lead at Example"),
        fact("founded", "Founded Acme in 2020"),
        fact("product", "Built Acme Protocol"),
        fact("exit", "Acme acquired in 2024"),
        fact("track_record", "Scaled Acme to one million users"),
        fact("funding", "Raised two rounds from the same lead investor"),
        fact("investor", "Paradigm backed two of the founder's ventures"),
        fact("network", "Named repeat founder and investor network"),
      ],
    }, axes);
    const founderFacts = extractScoringEvidenceCatalog(packet, axes)
      .filter((artifact) => artifact.section === "basicFacts");
    const eligibleAxes = (title: string) =>
      founderFacts.find((artifact) => artifact.title === title)?.eligibleAxes;

    expect(eligibleAxes("Verified founder identity")).toEqual(["F1_identity_verifiability"]);
    expect(eligibleAxes("CEO at Acme")).toEqual(["F1_identity_verifiability"]);
    expect(eligibleAxes("Previously engineering lead at Example")).toEqual(["F2_track_record"]);
    expect(eligibleAxes("Founded Acme in 2020")).toEqual(["F2_track_record"]);
    expect(eligibleAxes("Built Acme Protocol")).toEqual(["F2_track_record", "F4_build_substance"]);
    expect(eligibleAxes("Acme acquired in 2024")).toEqual(["F2_track_record"]);
    expect(eligibleAxes("Scaled Acme to one million users")).toEqual(["F2_track_record"]);
    expect(eligibleAxes("Raised two rounds from the same lead investor")).toBeUndefined();
    expect(eligibleAxes("Paradigm backed two of the founder's ventures")).toEqual(["F6_network_quality"]);
    expect(founderFacts.flatMap((artifact) => artifact.eligibleAxes)).not.toContain("F3_repeat_backing");
    expect(eligibleAxes("Named repeat founder and investor network")).toEqual(["F6_network_quality"]);
  });

  it("routes verified investor facts narrowly and excludes related-entity legal facts", () => {
    const axes: AnalystAxis[] = [
      { axis: "I1_identity_legitimacy", weight: 24, role: "INVESTOR" },
      { axis: "I2_portfolio_quality", weight: 24, role: "INVESTOR" },
      { axis: "I3_fund_scale_tier", weight: 20, role: "INVESTOR" },
      { axis: "I4_testimonial_signal", weight: 12, role: "INVESTOR" },
      { axis: "I5_reputation_fud", weight: 20, role: "INVESTOR" },
    ];
    const fact = (
      predicate: string,
      value: string,
      attributionScope?: "direct_subject" | "related_entity",
    ) => ({
      factId: `basic_fact_${predicate}_${value.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
      subjectKey: "famous-investor",
      predicate,
      value,
      normalizedValue: value.toLowerCase(),
      status: "verified",
      critical: true,
      ...(attributionScope ? { attributionScope } : {}),
      sources: [{
        url: `https://example.com/${predicate}`,
        title: `${predicate} source`,
        sourceClass: predicate === "legal_regulatory_event" ? "regulatory_or_onchain" : "official_subject",
        relation: "supports",
        excerpt: `${value} is confirmed by the cited source.`,
        contentHash: "i".repeat(64),
        capturedAt: "2026-07-13T12:00:00.000Z",
        provider: "public-web",
        artifactVerified: true,
      }],
      evidence_origin: "deterministic",
      artifact_verified: true,
      provider: "public-web",
    });
    const packet = buildScoringEvidencePacket({
      basicFacts: [
        fact("official_identity", "Verified investor identity"),
        fact("current_role", "Partner at Example Ventures"),
        fact("prior_role", "Previously operator at Acme"),
        fact("founder", "Founded Example Ventures"),
        fact("investor", "Personally invested in Portfolio Co"),
        fact("track_record", "Three source-backed portfolio exits"),
        fact("legal_regulatory_event", "Direct attributed regulatory event", "direct_subject"),
        fact("legal_regulatory_event", "Portfolio company regulatory event", "related_entity"),
      ],
    }, axes);
    const parsed = JSON.parse(packet) as { basicFacts: Array<{ value: string }> };
    const investorFacts = extractScoringEvidenceCatalog(packet, axes)
      .filter((artifact) => artifact.section === "basicFacts");
    const eligibleAxes = (title: string) =>
      investorFacts.find((artifact) => artifact.title === title)?.eligibleAxes;

    expect(eligibleAxes("Verified investor identity")).toEqual(["I1_identity_legitimacy"]);
    expect(eligibleAxes("Partner at Example Ventures")).toEqual(["I1_identity_legitimacy"]);
    expect(eligibleAxes("Previously operator at Acme")).toEqual(["I2_portfolio_quality"]);
    expect(eligibleAxes("Founded Example Ventures")).toEqual(["I2_portfolio_quality"]);
    expect(eligibleAxes("Personally invested in Portfolio Co")).toEqual(["I2_portfolio_quality"]);
    expect(eligibleAxes("Three source-backed portfolio exits")).toEqual(["I2_portfolio_quality"]);
    expect(eligibleAxes("Direct attributed regulatory event")).toEqual(["I5_reputation_fud"]);
    expect(parsed.basicFacts.map((basicFact) => basicFact.value)).not.toContain(
      "Portfolio company regulatory event",
    );
    const everyEligibleAxis = investorFacts.flatMap((artifact) => artifact.eligibleAxes);
    expect(everyEligibleAxis).not.toContain("I3_fund_scale_tier");
    expect(everyEligibleAxis).not.toContain("I4_testimonial_signal");
  });

  it("freezes official token-market evidence without overstating product or transparency coverage", () => {
    const axes: AnalystAxis[] = [
      { axis: "P3_token_conduct", weight: 20, role: "PROJECT" },
      { axis: "P5_traction_and_liveness", weight: 14, role: "PROJECT" },
    ];
    const packet = buildScoringEvidencePacket({
      projectToken: {
        verified: true,
        verification: "official_x",
        name: "Jupiter",
        symbol: "JUP",
        coingeckoId: "jupiter-exchange-solana",
        rank: 89,
        address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
        chain: "solana",
        officialX: "@JupiterExchange",
        sourceUrl: "https://www.coingecko.com/en/coins/jupiter-exchange-solana",
        capturedAt: "2026-07-12T17:00:00.000Z",
        providers: ["coingecko", "dexscreener", "geckoterminal"],
        priceUsd: 0.42,
        marketCapUsd: 620_000_000,
        history: {
          points: Array.from({ length: 90 }, (_, index) => 0.3 + index / 1_000),
          first: 0.3,
          last: 0.389,
          peak: 0.42,
          changePct: 29.666,
          drawdownPct: -7.38,
          timeframe: "day",
          poolAddress: "jup-usdc-pool",
        },
      },
    }, axes);
    const parsed = JSON.parse(packet);
    const tokenArtifact = extractScoringEvidenceCatalog(packet).find((artifact) => artifact.section === "projectToken");

    expect(parsed.projectToken).toMatchObject({
      verified: true,
      symbol: "JUP",
      history: { first: 0.3, last: 0.389, timeframe: "day" },
    });
    expect(parsed.projectToken.history).not.toHaveProperty("points");
    expect(tokenArtifact).toMatchObject({
      provider: "coingecko/dexscreener/geckoterminal",
      verification: "verified",
      scope: "direct_subject",
      eligibleAxes: axes.map(({ axis }) => axis),
    });
    expect(tokenArtifact).not.toHaveProperty("counterEligibleAxes");
  });

  it("separates a severe project-token drawdown from positive token evidence and limits it to traction", () => {
    const axes: AnalystAxis[] = [
      { axis: "P3_token_conduct", weight: 20, role: "PROJECT" },
      { axis: "P5_traction_and_liveness", weight: 14, role: "PROJECT" },
    ];
    const packet = buildScoringEvidencePacket({
      profile: {
        handle: "@drawdown_control",
        display_name: "Drawdown Control",
        days_since_post: 0,
        profile_collection_state: "resolved",
        profile_provider: "twitterapi",
        profile_captured_at: "2026-07-12T17:00:00.000Z",
      },
      projectToken: {
        verified: true,
        verification: "official_x",
        name: "Drawdown Control",
        symbol: "DOWN",
        coingeckoId: "drawdown-control",
        rank: 50,
        address: "0x000000000000000000000000000000000000d000",
        chain: "ethereum",
        officialX: "@drawdown_control",
        sourceUrl: "https://www.coingecko.com/en/coins/drawdown-control",
        capturedAt: "2026-07-12T17:00:00.000Z",
        providers: ["coingecko", "dexscreener", "geckoterminal"],
        marketCapUsd: 500_000_000,
        volume24hUsd: 25_000,
        liquidityUsd: 10_000_000,
        history: {
          first: 1,
          last: 0.2,
          peak: 1,
          changePct: -80,
          drawdownPct: -80,
          timeframe: "day",
          poolAddress: "down-usdc-pool",
        },
      },
      findings: [{
        finding_type: "ProjectTokenDrawdown",
        claim: "$DOWN recorded a verified 80.0% peak-to-latest drawdown in the captured daily market window. Price drawdown alone does not establish misconduct.",
        source_url: "https://www.coingecko.com/en/coins/drawdown-control",
        source_date: "2026-07-12T17:00:00.000Z",
        source_author: "coingecko",
        verification_status: "Verified",
        independent_source_count: 1,
        polarity: -1,
        evidence_origin: "deterministic",
        artifact_verified: true,
      }],
      basicFacts: [{
        predicate: "traction",
        value: "$30M verified daily protocol swap volume",
        status: "verified",
        artifact_verified: true,
      }],
    }, axes);
    const catalog = extractScoringEvidenceCatalog(packet, axes);
    const tokenArtifact = catalog.find((artifact) => artifact.section === "projectToken");
    const drawdownArtifact = catalog.find((artifact) => artifact.section === "findings");

    expect(tokenArtifact).not.toHaveProperty("counterEligibleAxes");
    expect(drawdownArtifact).toMatchObject({
      eligibleAxes: ["P5_traction_and_liveness"],
      counterEligibleAxes: ["P5_traction_and_liveness"],
    });
    const bands = deriveProjectStrengthBands(packet, axes);
    const tractionArtifact = catalog.find((artifact) => artifact.section === "basicFacts")!;
    const verdict = (score: number) => ({
      axes: [
        validAxis("P3_token_conduct", bands.P3_token_conduct.minScore, tokenArtifact!.artifactId),
        {
          ...validAxis("P5_traction_and_liveness", score, tractionArtifact.artifactId),
          counterEvidenceRefs: [drawdownArtifact!.artifactId],
        },
      ],
      headline: "Current protocol traction remains verified despite severe token drawdown.",
      identity_note: "Canonical project token identity is verified.",
    });

    expect(bands.P5_traction_and_liveness).toMatchObject({
      tier: "solid",
      minScore: 10,
      maxScore: 11,
    });
    expect(bands.P5_traction_and_liveness.reasons).toContain(
      "severe canonical-token drawdown caps exceptional traction",
    );
    expect(validateAnalystVerdict(verdict(0), axes, catalog, undefined, {
      projectScoreBands: bands,
    })).toBeNull();
    expect(validateAnalystVerdict(verdict(10), axes, catalog, undefined, {
      projectScoreBands: bands,
    })).not.toBeNull();
    const missingCounter = verdict(10);
    missingCounter.axes[1].counterEvidenceRefs = [];
    const rejection = vi.fn();
    expect(validateAnalystVerdict(missingCounter, axes, catalog, rejection, {
      projectScoreBands: bands,
    })).toBeNull();
    expect(rejection).toHaveBeenLastCalledWith(
      "project-required-counter-reference-missing:P5_traction_and_liveness",
    );
  });

  it("rejects catalog tampering that broadens a negative finding to an unrelated project axis", () => {
    const axes: AnalystAxis[] = [
      { axis: "P1_team_and_identity", weight: 16, role: "PROJECT" },
      { axis: "P3_token_conduct", weight: 20, role: "PROJECT" },
    ];
    const packet = buildScoringEvidencePacket({
      findings: [{
        finding_type: "TokenCollapse",
        claim: "The canonical token suffered a verified collapse.",
        source_url: "https://investigator.example/token-collapse",
        source_date: "2026-07-12",
        verification_status: "Verified",
        polarity: -1,
        evidence_origin: "deterministic",
        artifact_verified: true,
      }],
    }, axes);
    const parsed = JSON.parse(packet) as {
      evidenceCatalog: AxisEvidenceRecord[];
    };
    const finding = parsed.evidenceCatalog.find((artifact) => artifact.section === "findings")!;
    expect(finding.eligibleAxes).toEqual(["P3_token_conduct"]);
    expect(finding.counterEligibleAxes).toEqual(["P3_token_conduct"]);

    finding.eligibleAxes = ["P1_team_and_identity", "P3_token_conduct"];
    finding.counterEligibleAxes = ["P1_team_and_identity", "P3_token_conduct"];

    expect(extractScoringEvidenceCatalog(JSON.stringify(parsed), axes)).toEqual([]);
    (parsed as { schema_version?: number }).schema_version = 4;
    expect(extractScoringEvidenceCatalog(JSON.stringify(parsed), axes)).toEqual([]);
  });

  it("charges an unreachable project site to product substance once, not three axes", () => {
    const axes: AnalystAxis[] = [
      { axis: "P2_product_substance", weight: 24, role: SubjectClass.PROJECT },
      { axis: "P5_traction_and_liveness", weight: 14, role: SubjectClass.PROJECT },
      { axis: "P6_transparency_integrity", weight: 12, role: SubjectClass.PROJECT },
    ];
    const packet = buildScoringEvidencePacket({
      findings: [{
        finding_type: "SiteNotLive",
        claim: "The official project product surface does not resolve.",
        source_url: "https://offline.example",
        verification_status: "Verified",
        polarity: -1,
        evidence_origin: "deterministic",
        artifact_verified: true,
      }],
    }, axes);
    const finding = extractScoringEvidenceCatalog(packet, axes)
      .find((artifact) => artifact.section === "findings")!;
    const bands = deriveProjectStrengthBands(packet, axes);

    expect(finding.eligibleAxes).toEqual(["P2_product_substance"]);
    expect(finding.counterEligibleAxes).toEqual(["P2_product_substance"]);
    expect(bands.P2_product_substance.tier).toBe("adverse");
    expect(bands.P5_traction_and_liveness.tier).toBe("none");
    expect(bands.P6_transparency_integrity.tier).toBe("none");
  });

  it("routes investigator callouts to token conduct only when the claim is token-specific", () => {
    const axes: AnalystAxis[] = [
      { axis: "P3_token_conduct", weight: 20, role: SubjectClass.PROJECT },
      { axis: "P6_transparency_integrity", weight: 12, role: SubjectClass.PROJECT },
    ];
    const finding = (claim: string) => ({
      finding_type: "InvestigatorCallout",
      claim,
      source_url: "https://investigator.example/report",
      verification_status: "Verified",
      independent_source_count: 2,
      polarity: -1,
      evidence_origin: "deterministic",
      artifact_verified: true,
    });
    const generic = extractScoringEvidenceCatalog(buildScoringEvidencePacket({
      findings: [finding("The team made false claims about its corporate history.")],
    }, axes), axes).find((artifact) => artifact.section === "findings")!;
    const tokenSpecific = extractScoringEvidenceCatalog(buildScoringEvidencePacket({
      findings: [finding("The team concealed insider token dumps from attributed wallets.")],
    }, axes), axes).find((artifact) => artifact.section === "findings")!;

    expect(generic.eligibleAxes).toEqual(["P6_transparency_integrity"]);
    expect(tokenSpecific.eligibleAxes).toEqual(["P3_token_conduct", "P6_transparency_integrity"]);
  });

  it("attributes an identity-only project-token snapshot to CoinGecko alone", () => {
    const axes: AnalystAxis[] = [{ axis: "P3_token_conduct", weight: 20, role: "PROJECT" }];
    const packet = buildScoringEvidencePacket({
      projectToken: {
        verified: true,
        verification: "official_x",
        name: "Jupiter",
        symbol: "JUP",
        coingeckoId: "jupiter-exchange-solana",
        rank: 89,
        address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
        chain: "solana",
        officialX: "@JupiterExchange",
        sourceUrl: "https://www.coingecko.com/en/coins/jupiter-exchange-solana",
        capturedAt: "2026-07-12T17:00:00.000Z",
        providers: ["coingecko"],
      },
    }, axes);

    expect(extractScoringEvidenceCatalog(packet)).toContainEqual(expect.objectContaining({
      section: "projectToken",
      provider: "coingecko",
      eligibleAxes: ["P3_token_conduct"],
    }));
  });

  it("does not turn an unresolved placeholder profile into observed identity evidence", () => {
    const packet = buildScoringEvidencePacket({
      profile: {
        handle: "@missing",
        display_name: "missing",
        profile_collection_state: "unavailable",
        profile_provider: "twitterapi",
      },
    }, catalog);
    const parsed = JSON.parse(packet);
    const frozen = extractScoringEvidenceCatalog(packet);

    expect(parsed).not.toHaveProperty("profile");
    expect(frozen.some((artifact) => artifact.section === "profile")).toBe(false);
    expect(frozen.filter((artifact) => artifact.section === "axisGaps")).toHaveLength(catalog.length);
  });

  it("omits bare or credential-bearing links from frozen scorer artifacts", () => {
    const packet = buildScoringEvidencePacket({
      profile: { handle: "@subject", profile_collection_state: "resolved", profile_provider: "twitterapi" },
      team: [{ name: "Named Teammate", role: "CTO", linkedin: "linkedin.com/in/teammate" }],
      sourceArtifacts: [{
        kind: "press",
        provider: "google-news",
        title: "Unsafe source URL",
        sourceUrl: "https://user:secret@example.com/private",
        match: "observed",
      }, {
        kind: "press",
        provider: "google-news",
        title: "Sensitive query URL",
        sourceUrl: "https://example.com/article?token=secret&story=42#private",
        match: "observed",
      }],
    }, catalog);
    const frozen = extractScoringEvidenceCatalog(packet);

    expect(packet).not.toContain("user:secret");
    expect(packet).not.toContain("token=secret");
    expect(packet).not.toContain("#private");
    expect(frozen.find((artifact) => artifact.section === "team")).not.toHaveProperty("sourceUrl");
    expect(frozen.find((artifact) => artifact.title === "Unsafe source URL")).not.toHaveProperty("sourceUrl");
    expect(frozen.find((artifact) => artifact.title === "Sensitive query URL")?.sourceUrl).toBe(
      "https://example.com/article?story=42",
    );
  });

  it("keeps the decorated scorer packet and its exact catalog inside the structural budget", () => {
    const packet = buildScoringEvidencePacket({
      profile: { handle: "@subject", bio: "b".repeat(20_000), profile_collection_state: "resolved", profile_provider: "twitterapi" },
      recentActivity: Array.from({ length: 100 }, (_, index) => `post ${index} ${"x".repeat(4_000)}`),
      sourceArtifacts: Array.from({ length: 100 }, (_, index) => ({
        kind: "press",
        provider: "google-news",
        title: `Source ${index}`,
        sourceUrl: `https://example.com/${index}`,
        capturedAt: "2026-07-11T12:00:00.000Z",
        contentHash: String(index).padStart(64, "0"),
        match: "observed",
      })),
    }, catalog);

    expect(packet.length).toBeLessThanOrEqual(ANALYST_EVIDENCE_MAX_CHARS);
    const parsed = JSON.parse(packet);
    const artifacts = extractScoringEvidenceCatalog(packet);
    expect(artifacts).toHaveLength(parsed.evidenceCatalog.length);
    expect(artifacts.length).toBeGreaterThan(0);
  });

  it("fails closed with a bounded marker when required all-role coverage is irreducibly oversized", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const allRoles = Object.values(SubjectClass);
    const allAxes: AnalystAxis[] = allRoles.flatMap((role) =>
      Object.entries(getProfile(role).axes).map(([axis, weight]) => ({ axis, weight, role })));
    const filler = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [
      `field_${index}`,
      `${index}`.repeat(320),
    ]));
    const fatRow = (provider: string) => ({ provider, ...filler });
    const packet = buildScoringEvidencePacket({
      profile: {
        ...filler,
        handle: "@subject",
        display_name: "Subject",
        bio: "Named multi-role subject",
        profile_collection_state: "resolved",
        profile_provider: "twitterapi",
      },
      ventures: [fatRow("ventures")],
      testimonials: [fatRow("testimonials")],
      advised: [fatRow("advised")],
      promotions: [fatRow("promotions")],
      wallets: [fatRow("wallets")],
      team: [fatRow("team")],
      notableFollowers: [fatRow("notable-followers")],
      recentActivity: [fatRow("recent-activity")],
      clientEngagements: [fatRow("client-engagements")],
      associates: [fatRow("associates")],
      ventureTeams: [fatRow("venture-teams")],
    }, allAxes);

    expect(packet.length).toBeLessThanOrEqual(ANALYST_EVIDENCE_MAX_CHARS);
    expect(JSON.parse(packet)).toMatchObject({
      scoring_packet_state: "oversize",
      limit_chars: ANALYST_EVIDENCE_MAX_CHARS,
      requested_axis_count: 34,
      evidenceCatalog: [],
    });
    expect(extractScoringEvidenceCatalog(packet)).toEqual([]);
    expect(inspectAnalystScoringPreflight(allAxes, packet)).toMatchObject({
      state: "packet_oversize",
      requestedAxisCount: 34,
      evidenceArtifactCount: 0,
    });
    await expect(analyzeSubject("@subject", allRoles, allAxes, packet)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("recovers a verdict when the first analyst call transiently fails instead of abandoning to INCOMPLETE", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
    const evidenceJson = buildScoringEvidencePacket({
      profile: { handle: "@subject", display_name: "Subject", bio: "Named builder", profile_collection_state: "resolved", profile_provider: "twitterapi" },
      ventures: [{ project_name: "Verified Venture", role: "founder", outcome: "Active", artifact_verified: true }],
    }, catalog);
    const scorerCatalog = extractScoringEvidenceCatalog(evidenceJson);
    const aliasFor = (axis: string) => {
      const index = scorerCatalog.findIndex((artifact) =>
        artifact.verification !== "unavailable"
        && artifact.verification !== "checked_empty"
        && artifact.eligibleAxes.includes(axis));
      return `e${String(index + 1).padStart(3, "0")}`;
    };
    const validVerdict = {
      axes: [
        { axis: "F1_identity_verifiability", score: 10, rationale: "named identity", primaryEvidenceRef: aliasFor("F1_identity_verifiability"), additionalEvidenceRefs: [], counterEvidenceRefs: [], coverageRefs: [], gaps: [] },
        { axis: "F2_track_record", score: 20, rationale: "documented history", primaryEvidenceRef: aliasFor("F2_track_record"), additionalEvidenceRefs: [], counterEvidenceRefs: [], coverageRefs: [], gaps: [] },
      ],
      headline: "Evidence-backed result",
      identity_note: "Identity resolved",
    };
    let verdictCalls = 0;
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { tool_choice: { name: string } };
      if (request.tool_choice.name !== "record_verdict") {
        return new Response(JSON.stringify({ content: [{ type: "tool_use", name: request.tool_choice.name, input: { contradictions: [] } }], stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 2 } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      verdictCalls += 1;
      // First scoring attempt blips (a transient upstream 503); the retry must
      // recover rather than sinking the whole run to a null verdict.
      if (verdictCalls === 1) {
        return new Response("upstream unavailable", { status: 503, headers: { "content-type": "text/plain" } });
      }
      return new Response(JSON.stringify({ content: [{ type: "tool_use", name: "record_verdict", input: validVerdict }], stop_reason: "tool_use", usage: { input_tokens: 100, output_tokens: 20 } }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const verdict = await analyzeSubject("@subject", ["FOUNDER"], catalog, evidenceJson);

    expect(verdict).not.toBeNull();
    expect(verdict?.axes.map((axis) => axis.axis)).toEqual(catalog.map((axis) => axis.axis));
    expect(verdictCalls).toBeGreaterThanOrEqual(2);
  });

  it("structurally prunes an oversized trust graph to the hard scorer budget", () => {
    const long = "x".repeat(400);
    const ties = Array.from({ length: 4 }, (_, index) => ({
      key: `${long}${index}`,
      label: `${long}${index}`,
      type: long,
      strength: "hard",
      subjectEdgeTypes: Array(8).fill(long),
      otherEdgeTypes: Array(8).fill(long),
    }));
    const packet = buildScoringEvidencePacket({
      trustGraphScreen: {
        provider: "argus-graph",
        capturedAt: "2026-07-11T12:00:00.000Z",
        status: "risk",
        contributionCount: 8,
        qualifiedContributionCount: 8,
        sourceContentHash: "a".repeat(64),
        severity: "avoid",
        line: long,
        connections: Array.from({ length: 8 }, (_, index) => ({
          other: `${long}${index}`,
          otherReportVersionId: long,
          otherAttestation: "server_collected",
          otherCompleteness: "complete",
          otherVerdict: "FAIL",
          qualified: true,
          direct: true,
          ties,
        })),
      },
    }, [{ axis: "F5_reputation_integrity", weight: 18, role: "FOUNDER" }]);

    expect(packet.length).toBeLessThanOrEqual(ANALYST_EVIDENCE_MAX_CHARS);
    expect(extractScoringEvidenceCatalog(packet).length).toBeGreaterThan(0);
  });

  it("tells decision prompts that leads are excluded without discarding non-finding evidence", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
    const evidenceJson = buildScoringEvidencePacket({
      profile: { handle: "@subject", display_name: "Subject", bio: "Named builder", profile_collection_state: "resolved", profile_provider: "twitterapi" },
      ventures: [{ project_name: "Verified Venture", role: "founder", outcome: "Active", artifact_verified: true }],
    }, catalog);
    const scorerCatalog = extractScoringEvidenceCatalog(evidenceJson);
    const refFor = (axis: string) => scorerCatalog.find((artifact) =>
      artifact.verification !== "unavailable"
      && artifact.verification !== "checked_empty"
      && artifact.eligibleAxes.includes(axis))!.artifactId;
    const aliasFor = (axis: string) => {
      const index = scorerCatalog.findIndex((artifact) =>
        artifact.verification !== "unavailable"
        && artifact.verification !== "checked_empty"
        && artifact.eligibleAxes.includes(axis));
      return `e${String(index + 1).padStart(3, "0")}`;
    };
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { tool_choice: { name: string } };
      const input = request.tool_choice.name === "record_contradictions"
        ? { contradictions: [] }
        : {
            axes: [
              {
                axis: "F2_track_record",
                score: 20,
                rationale: "documented history",
                primaryEvidenceRef: aliasFor("F2_track_record"),
                additionalEvidenceRefs: [],
                counterEvidenceRefs: [],
                coverageRefs: [],
                gaps: [],
              },
              {
                axis: "F1_identity_verifiability",
                score: 10,
                rationale: "named identity",
                primaryEvidenceRef: aliasFor("F1_identity_verifiability"),
                additionalEvidenceRefs: [],
                counterEvidenceRefs: [],
                coverageRefs: [],
                gaps: [],
              },
            ],
            headline: "Evidence-backed result",
            identity_note: "Identity resolved",
          };
      return new Response(JSON.stringify({
        content: [{ type: "tool_use", name: request.tool_choice.name, input }],
        stop_reason: "tool_use",
        usage: { input_tokens: 100, output_tokens: 20 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    await scanContradictions("@subject", "{\"profile\":{\"handle\":\"@subject\"}}");
    const verdict = await analyzeSubject("@subject", ["FOUNDER"], catalog, evidenceJson);

    const requests = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as {
      system: string;
      messages: { content: string }[];
      tool_choice: { name: string; disable_parallel_tool_use?: boolean };
      max_tokens: number;
      tools: Array<{
        strict?: boolean;
        input_schema: {
          properties: {
            axes: {
              type: string;
              items: {
                properties: Record<string, { type: string; items?: { type: string } }>;
                required: string[];
                additionalProperties: boolean;
              };
            };
          };
        };
      }>;
    });
    const contradictionPrompt = promptText(requests.find((request) => request.tool_choice.name === "record_contradictions")?.system);
    const scoringPrompt = promptText(requests.find((request) => request.tool_choice.name === "record_verdict")?.messages[0]?.content);

    expect(contradictionPrompt).toContain("investigative leads are excluded from this evidence packet");
    expect(contradictionPrompt).toContain("when comparing or interpreting finding collections");
    expect(contradictionPrompt).toContain("profile, team, wallet, check-outcome");
    expect(scoringPrompt).toContain("investigative leads are excluded from this scoring packet");
    expect(scoringPrompt).toContain("when comparing or interpreting finding collections");
    expect(scoringPrompt).toContain("profile, team, wallet, check-outcome");
    expect(scoringPrompt).not.toContain("only rows in the findings array may influence");
    expect(scoringPrompt).toContain("Citation aliases");
    expect(scoringPrompt).toContain("Axis citation guidance");
    expect(scoringPrompt).toContain("primaryEvidenceRef must be one substantive alias");
    const expectedF1SubstantiveAliases = scorerCatalog.flatMap((artifact, index) =>
      artifact.verification !== "unavailable"
      && artifact.verification !== "checked_empty"
      && artifact.eligibleAxes.includes("F1_identity_verifiability")
        ? [`e${String(index + 1).padStart(3, "0")}`]
        : []);
    const expectedF1CoverageAliases = scorerCatalog.flatMap((artifact, index) =>
      (artifact.verification === "unavailable" || artifact.verification === "checked_empty")
      && artifact.eligibleAxes.includes("F1_identity_verifiability")
        ? [`e${String(index + 1).padStart(3, "0")}`]
        : []);
    const expectedF1AdverseAliases = scorerCatalog.flatMap((artifact, index) =>
      artifact.verification === "verified"
      && artifact.counterEligibleAxes?.includes("F1_identity_verifiability")
        ? [`e${String(index + 1).padStart(3, "0")}`]
        : []);
    expect(scoringPrompt).toContain(
      `F1_identity_verifiability | substantive aliases (choose 1 primary; do not exhaustively ` +
      `copy): ${expectedF1SubstantiveAliases.join(", ") || "(none)"}` +
      ` | verified score-limiting aliases (the only counterEvidenceRefs that can justify ` +
      `a PROJECT score below its evidence-strength band): ${expectedF1AdverseAliases.join(", ") || "(none)"}` +
      ` | coverageRefs preferred return set (optional; return 0-4 total, never the whole ` +
      `coverage catalog): ` +
      `${expectedF1CoverageAliases.join(", ") || "(none)"}`,
    );
    const verdictRequest = requests.find((request) => request.tool_choice.name === "record_verdict")!;
    const verdictTool = verdictRequest.tools[0];
    const axesSchema = verdictTool.input_schema.properties.axes;
    expect(verdictRequest.max_tokens).toBe(6000);
    expect(verdictRequest.tool_choice.disable_parallel_tool_use).toBe(true);
    expect(verdictTool.strict).toBe(true);
    expect(verdictTool.input_schema).toEqual(RECORD_VERDICT_INPUT_SCHEMA);
    expect(axesSchema.type).toBe("array");
    expect(axesSchema.items.additionalProperties).toBe(false);
    expect(axesSchema.items.required).toEqual(expect.arrayContaining([
      "axis",
      "score",
      "primaryEvidenceRef",
      "additionalEvidenceRefs",
      "counterEvidenceRefs",
      "coverageRefs",
      "gaps",
    ]));
    expect(axesSchema.items.properties.score.type).toBe("integer");
    expect(JSON.stringify(verdictTool.input_schema)).not.toContain("F1_identity_verifiability");
    expect(JSON.stringify(verdictTool.input_schema)).not.toMatch(/e\d{3}/);
    expect(verdict?.axes.map((axis) => axis.axis)).toEqual(catalog.map((axis) => axis.axis));
    expect(verdict?.axes.map((axis) => axis.evidenceRefs)).toEqual([
      [refFor("F1_identity_verifiability")],
      [refFor("F2_track_record")],
    ]);

    const unsupported = new Set([
      "minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems",
      "uniqueItems", "oneOf", "anyOf", "allOf", "prefixItems", "pattern",
    ]);
    const findUnsupported = (value: unknown): string[] => {
      if (!value || typeof value !== "object") return [];
      if (Array.isArray(value)) return value.flatMap(findUnsupported);
      return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [
        ...(unsupported.has(key) ? [key] : []),
        ...findUnsupported(child),
      ]);
    };
    expect(findUnsupported(verdictTool.input_schema)).toEqual([]);
  });

  it("quarantines a malformed contradiction result instead of aborting the audit", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      content: [{
        type: "tool_use",
        name: "record_contradictions",
        input: { contradictions: { claim: "not an array" } },
      }],
      stop_reason: "tool_use",
      usage: { input_tokens: 20, output_tokens: 10 },
    }), { status: 200, headers: { "content-type": "application/json" } })));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(scanContradictions("@subject", "{}")).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(
      "[agent-runtime]",
      expect.stringContaining("invalid_result_shape"),
    );
  });

  it("recovers a stringified contradiction array returned inside the tool contract", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      content: [{
        type: "tool_use",
        name: "record_contradictions",
        input: {
          contradictions: JSON.stringify([{
            claim: "The subject says liquidity is locked.",
            conflict: "The collected contract record shows the lock expired.",
            severity: "high",
            confidence: "high",
          }]),
        },
      }],
      stop_reason: "tool_use",
      usage: { input_tokens: 20, output_tokens: 10 },
    }), { status: 200, headers: { "content-type": "application/json" } })));

    await expect(scanContradictions("@subject", "{}")).resolves.toEqual([{
      claim: "The subject says liquidity is locked.",
      conflict: "The collected contract record shows the lock expired.",
      severity: "high",
      confidence: "high",
    }]);
  });

  it("skips contradiction analysis when the route has entered its finalization reserve", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(scanContradictions("@subject", "{}", {
      deadlineAt: Date.now() + 500,
    })).resolves.toBeNull();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      "[agent-runtime]",
      expect.stringContaining("contradictions_skipped_budget"),
    );
  });

  it("keeps the live 14-axis founder, investor, and member contract strict and bounded", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
    const productionRoles = [SubjectClass.FOUNDER, SubjectClass.INVESTOR, SubjectClass.MEMBER];
    const productionCatalog: AnalystAxis[] = productionRoles.flatMap((role) =>
      Object.entries(getProfile(role).axes).map(([axis, weight]) => ({ axis, weight, role })),
    );
    const evidenceJson = buildScoringEvidencePacket({
      profile: {
        handle: "@subject",
        display_name: "Subject",
        bio: "Named builder and investor with a documented community role",
        website: "https://subject.example",
        profile_collection_state: "resolved",
        profile_provider: "twitterapi",
        profile_captured_at: "2026-07-11T11:58:00.000Z",
      },
      ventures: [{
        project_name: "Verified Venture",
        role: "founder and investor",
        outcome: "Active",
        artifact_verified: true,
      }],
      testimonials: [{
        claimed_endorser_handle: "@verified_backer",
        claimed_relationship: "repeat backer",
        artifact_verified: true,
      }],
      recentActivity: [{
        provider: "twitterapi",
        text: "Documented product, portfolio, and community activity",
        capturedAt: "2026-07-11T12:00:00.000Z",
      }],
      sourceArtifacts: Array.from({ length: 24 }, (_, index) => index === 0
        ? {
            kind: "trust_graph",
            provider: "argus-graph",
            title: "Qualified graph evidence",
            excerpt: "Exact report-bound connection",
            sourceUrl: "https://argus.example/report",
            capturedAt: "2026-07-11T12:00:00.000Z",
            contentHash: "a".repeat(64),
            sourceContentHash: "b".repeat(64),
            match: "risk_signal",
          }
        : index === 1
          ? {
              kind: "portfolio_relationship",
              provider: "portfolio-web",
              title: "Subject → Verified Portfolio Company",
              excerpt: "Verified Portfolio Company appears on the subject's official portfolio page.",
              sourceUrl: "https://subject.example/portfolio/verified-company",
              capturedAt: "2026-07-11T12:00:00.000Z",
              contentHash: "c".repeat(64),
              sourceContentHash: "d".repeat(64),
              match: "relationship_confirmed",
              relationship: "invested_in",
              subjectName: "Subject",
              projectName: "Verified Portfolio Company",
              sourceClass: "first_party_subject",
            }
          : index === 2
            ? verifiedFundScaleArtifact({ contentHash: "e".repeat(64), sourceContentHash: "f".repeat(64) })
        : {
            kind: "press",
            provider: "google-news",
            title: `Verified source ${index}`,
            excerpt: `Independent evidence ${index} ${"e".repeat(20)}`,
            sourceUrl: `https://news.example/source-${index}`,
            capturedAt: "2026-07-11T12:00:00.000Z",
            contentHash: index.toString(16).padStart(64, "0"),
            match: "exact_name",
          }),
    }, productionCatalog);
    const scorerCatalog = extractScoringEvidenceCatalog(evidenceJson);
    const aliasFor = (axis: string) => {
      const index = scorerCatalog.findIndex((artifact) =>
        artifact.verification !== "unavailable"
        && artifact.verification !== "checked_empty"
        && artifact.eligibleAxes.includes(axis));
      expect(index).toBeGreaterThanOrEqual(0);
      return `e${String(index + 1).padStart(3, "0")}`;
    };
    let requestBody = "";
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      requestBody = String(init?.body);
      const request = JSON.parse(requestBody) as { tool_choice: { name: string } };
      const axes = productionCatalog.map(({ axis, weight }) => ({
        axis,
        score: Math.floor(weight * 0.7),
        rationale: `Evidence-backed rationale for ${axis}`,
        primaryEvidenceRef: aliasFor(axis),
        additionalEvidenceRefs: [],
        counterEvidenceRefs: [],
        coverageRefs: [],
        gaps: [],
      }));
      return new Response(JSON.stringify({
        content: [{
          type: "tool_use",
          name: request.tool_choice.name,
          input: {
            axes,
            headline: "Evidence-backed multi-role result",
            identity_note: "Identity resolved",
          },
        }],
        stop_reason: "tool_use",
        usage: { input_tokens: 4000, output_tokens: 1200 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const verdict = await analyzeSubject(
      "@subject",
      productionRoles,
      productionCatalog,
      evidenceJson,
    );

    const request = JSON.parse(requestBody) as {
      tools: Array<{
        strict?: boolean;
        input_schema: {
          properties: {
            axes: {
              type: string;
              items: {
                properties: Record<string, { type: string }>;
                required: string[];
                additionalProperties: boolean;
              };
            };
          };
          required: string[];
          additionalProperties: boolean;
        };
      }>;
    };
    const tool = request.tools[0];
    const axesSchema = tool.input_schema.properties.axes;
    expect(productionCatalog).toHaveLength(14);
    expect(evidenceJson.length).toBeGreaterThan(20_000);
    expect(scorerCatalog.length).toBeGreaterThanOrEqual(20);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestBody.length).toBeLessThan(100_000);
    expect(JSON.stringify(tool.input_schema).length).toBeLessThan(2_048);
    expect(tool.strict).toBe(true);
    expect(tool.input_schema).toEqual(RECORD_VERDICT_INPUT_SCHEMA);
    expect(tool.input_schema.required).toEqual(["axes", "headline", "identity_note"]);
    expect(tool.input_schema.additionalProperties).toBe(false);
    expect(axesSchema.type).toBe("array");
    expect(axesSchema.items.required).toEqual(Object.keys(axesSchema.items.properties));
    expect(axesSchema.items.additionalProperties).toBe(false);
    expect(axesSchema.items.properties.score.type).toBe("integer");
    expect(JSON.stringify(tool.input_schema)).not.toContain("enum");
    expect(JSON.stringify(tool.input_schema)).not.toMatch(/e\d{3}/);
    expect(JSON.stringify(tool.input_schema)).not.toContain("F1_identity_verifiability");
    expect(verdict?.axes.map(({ axis }) => axis)).toEqual(productionCatalog.map(({ axis }) => axis));
  });

  it("keeps the invariant grammar and exact validator contract across all 34 methodology axes", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
    const allRoles = Object.values(SubjectClass);
    const allAxes: AnalystAxis[] = allRoles.flatMap((role) =>
      Object.entries(getProfile(role).axes).map(([axis, weight]) => ({ axis, weight, role })),
    );
    const evidenceJson = buildScoringEvidencePacket({
      profile: {
        handle: "@subject",
        display_name: "Subject",
        bio: "Named builder, investor, adviser, promoter, agency operator, and community contributor",
        website: "https://subject.example",
        profile_collection_state: "resolved",
        profile_provider: "twitterapi",
        profile_captured_at: "2026-07-11T11:58:00.000Z",
      },
      ventures: [{
        project_name: "Verified Venture",
        role: "founder, investor, adviser, and agency client",
        outcome: "Active",
        artifact_verified: true,
      }],
      testimonials: [{
        claimed_endorser_handle: "@verified_backer",
        claimed_relationship: "repeat backer and advisory counterparty",
        artifact_verified: true,
      }],
      advised: [{
        project_name: "Verified Advisory Project",
        claimed_role: "advisor",
        artifact_verified: true,
      }],
      promotions: [{
        ticker: "$TEST",
        chain: "ethereum",
        artifact_verified: true,
      }],
      team: [{
        name: "Named Teammate",
        role: "CTO and strategic advisor",
        linkedin: "https://linkedin.com/in/named-teammate",
        artifact_verified: true,
      }, {
        name: "Named Co-founder",
        role: "Co-founder",
        artifact_verified: true,
      }],
      basicFacts: [
        { predicate: "official_identity", value: "Subject", status: "verified", artifact_verified: true },
        { predicate: "legal_entity", value: "Subject Labs", status: "verified", artifact_verified: true },
        { predicate: "product", value: "Live protocol", status: "verified", artifact_verified: true },
        { predicate: "repository", value: "github.com/subject/protocol", status: "verified", artifact_verified: true },
        { predicate: "governance", value: "Token-holder governance", status: "verified", artifact_verified: true },
        { predicate: "audit", value: "Independent protocol audit", status: "verified", artifact_verified: true },
        { predicate: "funding", value: "Bootstrapped with a disclosed treasury", status: "verified", artifact_verified: true },
        { predicate: "traction", value: "Verified protocol transaction volume", status: "verified", artifact_verified: true },
      ],
      projectToken: {
        verified: true,
        verification: "official_domain",
        name: "Subject Token",
        symbol: "SUBJ",
        coingeckoId: "subject-token",
        rank: 100,
        address: "0x0000000000000000000000000000000000005ab1",
        chain: "ethereum",
        sourceUrl: "https://subject.example/token",
        capturedAt: "2026-07-11T12:00:00.000Z",
        providers: ["coingecko", "dexscreener", "geckoterminal"],
        marketCapUsd: 250_000_000,
        volume24hUsd: 8_000_000,
        liquidityUsd: 6_000_000,
      },
      recentActivity: [{
        provider: "twitterapi",
        text: "Documented product, portfolio, promotional, advisory, agency, and community activity",
        capturedAt: "2026-07-11T12:00:00.000Z",
      }],
      clientEngagements: [{
        client: "Verified Client",
        service: "growth and engineering",
        artifact_verified: true,
      }],
      sourceArtifacts: [{
        kind: "portfolio_relationship",
        provider: "portfolio-web",
        title: "Subject → Verified Portfolio Company",
        excerpt: "Verified Portfolio Company appears on the subject's official portfolio page.",
        sourceUrl: "https://subject.example/portfolio/verified-company",
        capturedAt: "2026-07-11T12:00:00.000Z",
        contentHash: "a".repeat(64),
        sourceContentHash: "b".repeat(64),
        match: "relationship_confirmed",
        relationship: "invested_in",
        subjectName: "Subject",
        projectName: "Verified Portfolio Company",
        sourceClass: "first_party_subject",
      }, verifiedFundScaleArtifact({ contentHash: "c".repeat(64), sourceContentHash: "d".repeat(64) }), {
        kind: "press",
        provider: "google-news",
        title: "Subject partners with Regulated Counterparty and launches production integration",
        excerpt: "The companies launched the live protocol integration together.",
        sourceUrl: "https://news.example/subject-integration",
        capturedAt: "2026-07-11T12:00:00.000Z",
        contentHash: "e".repeat(64),
        match: "exact_handle",
      }],
    }, allAxes);
    const scorerCatalog = extractScoringEvidenceCatalog(evidenceJson);
    const projectBands = deriveProjectStrengthBands(evidenceJson, allAxes);
    const aliasFor = (axis: string) => {
      const index = scorerCatalog.findIndex((artifact) =>
        artifact.verification !== "unavailable"
        && artifact.verification !== "checked_empty"
        && artifact.eligibleAxes.includes(axis));
      expect(index).toBeGreaterThanOrEqual(0);
      return `e${String(index + 1).padStart(3, "0")}`;
    };
    let requestSchema: unknown;
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        tool_choice: { name: string };
        tools: Array<{ input_schema: unknown }>;
      };
      requestSchema = request.tools[0].input_schema;
      return new Response(JSON.stringify({
        content: [{
          type: "tool_use",
          name: request.tool_choice.name,
          input: {
            axes: allAxes.map(({ axis, weight, role }) => ({
              axis,
              score: role === SubjectClass.PROJECT
                ? projectBands[axis].minScore
                : Math.floor(weight * 0.7),
              rationale: `Evidence-backed rationale for ${axis}`,
              primaryEvidenceRef: aliasFor(axis),
              additionalEvidenceRefs: [],
              counterEvidenceRefs: [],
              coverageRefs: [],
              gaps: [],
            })),
            headline: "Evidence-backed all-role result",
            identity_note: "Identity resolved",
          },
        }],
        stop_reason: "tool_use",
        usage: { input_tokens: 8_000, output_tokens: 4_000 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const verdict = await analyzeSubject("@subject", allRoles, allAxes, evidenceJson);

    expect(allAxes).toHaveLength(34);
    expect(requestSchema).toEqual(RECORD_VERDICT_INPUT_SCHEMA);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(verdict?.axes.map(({ axis }) => axis)).toEqual(allAxes.map(({ axis }) => axis));
  });

  it("fails before the provider call when the scorer packet has no valid frozen catalog", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(analyzeSubject(
      "@subject",
      ["FOUNDER"],
      catalog,
      "{\"profile\":{\"handle\":\"@subject\"}}",
    )).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts a complete verdict after deterministic counter-evidence precedence", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
    const evidenceJson = buildScoringEvidencePacket({
      profile: {
        handle: "@subject",
        display_name: "Subject",
        bio: "Named founder of Verified Venture",
        profile_collection_state: "resolved",
        profile_provider: "twitterapi",
      },
      ventures: [{
        project_name: "Verified Venture",
        role: "founder",
        outcome: "Active",
        artifact_verified: true,
      }],
      checkOutcomes: [{
        checkId: "identity-resolution",
        status: "confirmed",
        provider: "github",
        note: "The subject controls a long-lived, independently attributed account.",
      }],
    }, catalog);
    const scorerCatalog = extractScoringEvidenceCatalog(evidenceJson);
    const aliasesFor = (axis: string) => scorerCatalog.flatMap((artifact, index) =>
      artifact.verification !== "unavailable"
      && artifact.verification !== "checked_empty"
      && artifact.eligibleAxes.includes(axis)
        ? [`e${String(index + 1).padStart(3, "0")}`]
        : []);
    const f1Aliases = aliasesFor("F1_identity_verifiability");
    const f2Alias = aliasesFor("F2_track_record")[0];
    expect(f1Aliases.length).toBeGreaterThanOrEqual(2);
    expect(f2Alias).toBeTruthy();

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      content: [{
        type: "tool_use",
        name: "record_verdict",
        input: {
          axes: [
            {
              axis: "F1_identity_verifiability",
              score: 8,
              rationale: "Identity has independent support and one contradictory artifact.",
              primaryEvidenceRef: f1Aliases[0],
              additionalEvidenceRefs: [f1Aliases[1]],
              counterEvidenceRefs: [f1Aliases[0]],
              coverageRefs: [],
              gaps: [],
            },
            {
              axis: "F2_track_record",
              score: 20,
              rationale: "The venture record is documented.",
              primaryEvidenceRef: f2Alias,
              additionalEvidenceRefs: [],
              counterEvidenceRefs: [],
              coverageRefs: [],
              gaps: [],
            },
          ],
          headline: "Independent support remains after contradictory evidence is separated.",
          identity_note: "Identity is supported by the collected profile and venture evidence.",
        },
      }],
      stop_reason: "tool_use",
      usage: { input_tokens: 100, output_tokens: 20 },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    const verdict = await analyzeSubject("@subject", ["FOUNDER"], catalog, evidenceJson);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(verdict?.axes[0]).toMatchObject({
      evidenceRefs: [scorerCatalog[Number.parseInt(f1Aliases[1].slice(1), 10) - 1].artifactId],
      counterEvidenceRefs: [scorerCatalog[Number.parseInt(f1Aliases[0].slice(1), 10) - 1].artifactId],
    });
  });

  it("treats the sole harmful artifact as primary support for an adverse project band", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
    const axes: AnalystAxis[] = [{ axis: "P3_token_conduct", weight: 20, role: SubjectClass.PROJECT }];
    const evidenceJson = buildScoringEvidencePacket({
      findings: [{
        finding_type: "TokenCollapse",
        claim: "The canonical token suffered a verified collapse.",
        source_url: "https://investigator.example/token-collapse",
        verification_status: "Verified",
        polarity: -1,
        evidence_origin: "deterministic",
        artifact_verified: true,
      }],
    }, axes);
    const scorerCatalog = extractScoringEvidenceCatalog(evidenceJson, axes);
    const alias = "e001";
    let prompt = "";
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
      prompt = promptText(body.messages[0].content);
      return new Response(JSON.stringify({
        content: [{
          type: "tool_use",
          name: "record_verdict",
          input: {
            axes: [{
              axis: "P3_token_conduct",
              score: 3,
              rationale: "The verified collapse is direct adverse token-conduct evidence.",
              primaryEvidenceRef: alias,
              additionalEvidenceRefs: [],
              counterEvidenceRefs: [alias],
              coverageRefs: [],
              gaps: [],
            }],
            headline: "Verified token collapse governs the assessment.",
            identity_note: "Identity is not material to the verified token finding.",
          },
        }],
        stop_reason: "tool_use",
        usage: { input_tokens: 100, output_tokens: 20 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    const verdict = await analyzeSubject("@harmful", [SubjectClass.PROJECT], axes, evidenceJson);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(prompt).toContain("cite a verified harmful alias as primary support");
    expect(verdict?.axes[0]).toMatchObject({
      score: 3,
      evidenceRefs: [scorerCatalog[0].artifactId],
      counterEvidenceRefs: [],
    });
  });

  it("distinguishes no methodology axes and unsupported axes from evidence gaps", () => {
    const profile = {
      handle: "@subject",
      display_name: "Subject",
      bio: "Investor",
      profile_collection_state: "resolved",
      profile_provider: "twitterapi",
    };
    const noAxesPacket = buildScoringEvidencePacket({ profile }, []);
    const unsupportedAxes: AnalystAxis[] = [{
      axis: "I9_unwired_methodology_axis",
      weight: 10,
      role: "INVESTOR",
    }];
    const unsupportedPacket = buildScoringEvidencePacket({ profile }, unsupportedAxes);

    expect(inspectAnalystScoringPreflight([], noAxesPacket)).toEqual({
      state: "no_axes",
      requestedAxisCount: 0,
      evidenceArtifactCount: 0,
      missingSubstantiveAxes: [],
      unsupportedAxes: [],
    });
    expect(inspectAnalystScoringPreflight(unsupportedAxes, unsupportedPacket)).toEqual({
      state: "unsupported_axes",
      requestedAxisCount: 1,
      evidenceArtifactCount: 0,
      missingSubstantiveAxes: [],
      unsupportedAxes: ["I9_unwired_methodology_axis"],
    });
  });

  it("diagnoses true I2 and I3 coverage abstentions before any scorer provider call", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const unsupportedInvestorAxes: AnalystAxis[] = [
      { axis: "I2_portfolio_quality", weight: 25, role: "INVESTOR" },
      { axis: "I3_fund_scale_tier", weight: 15, role: "INVESTOR" },
    ];
    const evidenceJson = buildScoringEvidencePacket({
      checkOutcomes: [{
        checkId: "vc-portfolio-track-record",
        status: "unavailable",
        provider: "portfolio-web",
        note: "Provider unavailable.",
      }],
    }, unsupportedInvestorAxes);

    expect(inspectAnalystScoringPreflight(unsupportedInvestorAxes, evidenceJson)).toMatchObject({
      state: "insufficient_evidence",
      missingSubstantiveAxes: ["I2_portfolio_quality", "I3_fund_scale_tier"],
    });
    await expect(analyzeSubject("@subject", ["INVESTOR"], unsupportedInvestorAxes, evidenceJson)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith(
      "[agent-preflight]",
      expect.stringContaining('"missingSubstantiveAxes":["I2_portfolio_quality","I3_fund_scale_tier"]'),
    );
  });

  it("makes one bounded semantic repair attempt after a schema-valid array omits an axis", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
    const evidenceJson = buildScoringEvidencePacket({
      profile: {
        handle: "@subject",
        display_name: "Subject",
        bio: "Named builder",
        profile_collection_state: "resolved",
        profile_provider: "twitterapi",
      },
      ventures: [{
        project_name: "Verified Venture",
        role: "founder",
        outcome: "Active",
        artifact_verified: true,
      }],
    }, catalog);
    const scorerCatalog = extractScoringEvidenceCatalog(evidenceJson);
    const aliasFor = (axis: string) => {
      const index = scorerCatalog.findIndex((artifact) =>
        artifact.verification !== "unavailable"
        && artifact.verification !== "checked_empty"
        && artifact.eligibleAxes.includes(axis));
      return `e${String(index + 1).padStart(3, "0")}`;
    };
    const strictAxis = (axis: string, score: number) => ({
      axis,
      score,
      rationale: "Evidence-backed rationale",
      primaryEvidenceRef: aliasFor(axis),
      additionalEvidenceRefs: [],
      counterEvidenceRefs: [],
      coverageRefs: [],
      gaps: [],
    });
    let attempt = 0;
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      attempt += 1;
      const request = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }>; tool_choice: { name: string } };
      const f1 = strictAxis("F1_identity_verifiability", 10);
      const input = {
        axes: attempt === 1
          ? [f1]
          : [f1, strictAxis("F2_track_record", 20)],
        headline: "Evidence-backed result",
        identity_note: "Identity resolved",
      };
      if (attempt === 2) {
        expect(promptText(request.messages[0].content)).toContain(
          "axis-count",
        );
      }
      return new Response(JSON.stringify({
        content: [{ type: "tool_use", name: request.tool_choice.name, input }],
        stop_reason: "tool_use",
        usage: { input_tokens: 100, output_tokens: 20 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const verdict = await analyzeSubject("@subject", ["FOUNDER"], catalog, evidenceJson);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(verdict?.axes.map((axis) => axis.axis)).toEqual(catalog.map((axis) => axis.axis));
  });

  it("repairs every project axis outside its evidence-strength band in one retry", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
    const projectAxes: AnalystAxis[] = [
      { axis: "P1_team_and_identity", weight: 16, role: SubjectClass.PROJECT },
      { axis: "P4_backing_and_partners", weight: 14, role: SubjectClass.PROJECT },
    ];
    const evidenceJson = buildScoringEvidencePacket({
      profile: {
        handle: "@established_project",
        display_name: "Established Project",
        profile_collection_state: "resolved",
        profile_provider: "twitterapi",
      },
      team: [
        { name: "Founder One", role: "Co-founder", provider: "team-page", artifact_verified: true },
        { name: "Founder Two", role: "Co-founder", provider: "team-page", artifact_verified: true },
      ],
      basicFacts: [{
        predicate: "official_identity",
        value: "Established Project",
        status: "verified",
        artifact_verified: true,
      }, {
        predicate: "investor",
        value: "Regulated Counterparty disclosed as a strategic backer",
        status: "verified",
        artifact_verified: true,
      }],
      sourceArtifacts: [{
        kind: "press",
        provider: "google-news",
        title: "Established Project partners with Regulated Counterparty",
        excerpt: "The companies launched the integration together.",
        sourceUrl: "https://news.example/established-partnership",
        capturedAt: "2026-07-12T12:00:00.000Z",
        contentHash: "7".repeat(64),
        match: "exact_handle",
      }],
    }, projectAxes);
    const scorerCatalog = extractScoringEvidenceCatalog(evidenceJson, projectAxes);
    const aliasFor = (axis: string) => {
      const index = scorerCatalog.findIndex((artifact) =>
        artifact.verification !== "unavailable"
        && artifact.verification !== "checked_empty"
        && artifact.eligibleAxes.includes(axis));
      expect(index).toBeGreaterThanOrEqual(0);
      return `e${String(index + 1).padStart(3, "0")}`;
    };
    let attempt = 0;
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      attempt += 1;
      const request = JSON.parse(String(init?.body)) as {
        messages: Array<{ content: string }>;
        tool_choice: { name: string };
      };
      if (attempt === 1) {
        expect(promptText(request.messages[0].content)).toContain(
          "P1_team_and_identity: exceptional evidence, allowed 14-16; P4_backing_and_partners: solid evidence, allowed 10-11",
        );
      } else {
        expect(promptText(request.messages[0].content)).toContain(
          "project-scores-outside-evidence-strength-band:P1_team_and_identity,P4_backing_and_partners",
        );
        expect(promptText(request.messages[0].content)).toContain(
          "Required bands by axis: P1_team_and_identity: 14-16 (exceptional); P4_backing_and_partners: 10-11 (solid)",
        );
      }
      const input = {
        axes: projectAxes.map(({ axis }) => ({
          axis,
          score: attempt === 1
            ? axis === "P1_team_and_identity" ? 12 : 9
            : axis === "P1_team_and_identity" ? 14 : 11,
          rationale: `Evidence-backed rationale for ${axis}`,
          primaryEvidenceRef: aliasFor(axis),
          additionalEvidenceRefs: [],
          counterEvidenceRefs: [],
          coverageRefs: [],
          gaps: [],
        })),
        headline: "Established project with verified fundamentals",
        identity_note: "Two named founders are verified",
      };
      return new Response(JSON.stringify({
        content: [{ type: "tool_use", name: request.tool_choice.name, input }],
        stop_reason: "tool_use",
        usage: { input_tokens: 100, output_tokens: 20 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const verdict = await analyzeSubject(
      "@established_project",
      [SubjectClass.PROJECT],
      projectAxes,
      evidenceJson,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(verdict?.axes.map(({ score }) => score)).toEqual([14, 11]);
  });

  it("promotes already-selected substantive support when the primary is coverage-only", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
    const evidenceJson = buildScoringEvidencePacket({
      profile: {
        handle: "@subject",
        display_name: "Subject",
        bio: "Named builder",
        profile_collection_state: "resolved",
        profile_provider: "twitterapi",
      },
      ventures: [{
        project_name: "Verified Venture",
        role: "founder",
        outcome: "Active",
        artifact_verified: true,
      }],
      checkOutcomes: [{
        checkId: "identity-resolution",
        status: "unavailable",
        provider: "peopledatalabs",
        note: "One identity provider was unavailable.",
      }],
    }, catalog);
    const scorerCatalog = extractScoringEvidenceCatalog(evidenceJson);
    const aliasFor = (
      axis: string,
      predicate: (artifact: AxisEvidenceRecord) => boolean,
    ) => {
      const index = scorerCatalog.findIndex((artifact) =>
        predicate(artifact) && artifact.eligibleAxes.includes(axis));
      expect(index).toBeGreaterThanOrEqual(0);
      return `e${String(index + 1).padStart(3, "0")}`;
    };
    const substantive = (artifact: AxisEvidenceRecord) =>
      artifact.verification !== "unavailable" && artifact.verification !== "checked_empty";
    const coverageOnly = (artifact: AxisEvidenceRecord) =>
      artifact.verification === "unavailable" || artifact.verification === "checked_empty";
    const f1Support = aliasFor("F1_identity_verifiability", substantive);
    const f1Coverage = aliasFor("F1_identity_verifiability", coverageOnly);
    const f2Support = aliasFor("F2_track_record", substantive);
    const axisRow = (axis: string, score: number, primaryEvidenceRef: string) => ({
      axis,
      score,
      rationale: "Evidence-backed rationale",
      primaryEvidenceRef,
      additionalEvidenceRefs: [],
      counterEvidenceRefs: [],
      coverageRefs: [],
      gaps: [],
    });
    let attempt = 0;
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      attempt += 1;
      const request = JSON.parse(String(init?.body)) as {
        messages: Array<{ content: string }>;
        tool_choice: { name: string };
      };
      const f1 = attempt === 1
        ? {
            ...axisRow("F1_identity_verifiability", 10, f1Coverage),
            additionalEvidenceRefs: [f1Support],
          }
        : {
            ...axisRow("F1_identity_verifiability", 10, f1Support),
            coverageRefs: [f1Coverage],
            gaps: ["One identity provider was unavailable."],
          };
      return new Response(JSON.stringify({
        content: [{
          type: "tool_use",
          name: request.tool_choice.name,
          input: {
            axes: [f1, axisRow("F2_track_record", 20, f2Support)],
            headline: "Evidence-backed result",
            identity_note: "Identity resolved",
          },
        }],
        stop_reason: "tool_use",
        usage: { input_tokens: 100, output_tokens: 20 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const verdict = await analyzeSubject("@subject", ["FOUNDER"], catalog, evidenceJson);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const artifactIdForAlias = (alias: string) =>
      scorerCatalog[Number.parseInt(alias.slice(1), 10) - 1].artifactId;
    expect(verdict?.axes[0].evidenceRefs).toEqual([
      artifactIdForAlias(f1Support),
    ]);
    expect(verdict?.axes.map((axis) => axis.axis)).toEqual(catalog.map((axis) => axis.axis));
  });

  it("bounds model-facing coverage candidates and repairs exhaustive coverage copying", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
    const singleAxisCatalog: AnalystAxis[] = [{
      axis: "F1_identity_verifiability",
      weight: 12,
      role: "FOUNDER",
    }];
    const evidenceJson = buildScoringEvidencePacket({
      profile: {
        handle: "@subject",
        display_name: "Subject",
        profile_collection_state: "resolved",
        profile_provider: "twitterapi",
      },
      sourceArtifacts: [
        {
          kind: "legal_case",
          provider: "courtlistener",
          match: "no_match",
          title: "US legal-history exact-name screen",
        },
        {
          kind: "sanctions_screen",
          provider: "sanctions-secondary",
          match: "no_match",
          title: "Secondary sanctions exact-name screen",
        },
      ],
      checkOutcomes: [
        { checkId: "identity-resolution", status: "unavailable", provider: "peopledatalabs", note: "Identity provider unavailable." },
        { checkId: "identity-continuity", status: "checked-empty", provider: "memory.lol", note: "No prior handle found." },
        { checkId: "ofac-sanctions-name", status: "checked-empty", provider: "opensanctions", note: "No exact sanctions match." },
        { checkId: "trust-graph-connections", status: "checked-empty", provider: "argus-graph", note: "No qualified graph connection." },
      ],
    }, singleAxisCatalog);
    const scorerCatalog = extractScoringEvidenceCatalog(evidenceJson);
    const aliasRows = scorerCatalog.map((artifact, index) => ({
      artifact,
      alias: `e${String(index + 1).padStart(3, "0")}`,
    }));
    const substantiveAlias = aliasRows.find(({ artifact }) =>
      artifact.verification !== "unavailable" && artifact.verification !== "checked_empty")?.alias;
    const orderedCoverage = aliasRows
      .filter(({ artifact }) => artifact.verification === "unavailable" || artifact.verification === "checked_empty")
      .sort((a, b) => Number(b.artifact.verification === "unavailable") - Number(a.artifact.verification === "unavailable"));
    const coverageCandidates = orderedCoverage.slice(0, 4).map(({ alias }) => alias);
    const omittedCoverageAlias = orderedCoverage[4]?.alias;
    if (!substantiveAlias || !omittedCoverageAlias) throw new Error("coverage fixture did not produce bounded aliases");
    expect(coverageCandidates).toHaveLength(4);

    let attempt = 0;
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      attempt += 1;
      const request = JSON.parse(String(init?.body)) as {
        messages: Array<{ content: string }>;
        tool_choice: { name: string };
      };
      expect(promptText(request.messages[0].content)).toContain("PUBLIC DILIGENCE GAP RULE");
      expect(promptText(request.messages[0].content)).toContain("government-issued ID, passport, SSN or tax ID, home address");
      expect(promptText(request.messages[0].content)).toContain("private account credentials");
      expect(promptText(request.messages[0].content)).toContain("other non-public personal proof");
      expect(promptText(request.messages[0].content)).toContain(
        "A checked-empty reference records a completed clear or negative screen",
      );
      expect(promptText(request.messages[0].content)).toContain(
        "it is not an evidence gap and must not create a gap line by itself",
      );
      const eligibilityLine = promptText(request.messages[0].content).split("\n")
        .find((line) => line.startsWith("F1_identity_verifiability |")) ?? "";
      expect(eligibilityLine).toContain(
        `coverageRefs preferred return set (optional; return 0-4 total, never the whole ` +
        `coverage catalog): ${coverageCandidates.join(", ")}`,
      );
      expect(eligibilityLine).not.toContain(omittedCoverageAlias);
      if (attempt === 2) {
        expect(promptText(request.messages[0].content)).toContain(
          "coverage-reference-limit-observed-5-max-4:F1_identity_verifiability",
        );
        expect(promptText(request.messages[0].content)).toContain(
          `The prior F1_identity_verifiability coverageRefs contained 5 aliases; the maximum is 4. ` +
          `Return no more than these four preferred aliases: ${coverageCandidates.join(", ")}`,
        );
        expect(promptText(request.messages[0].content)).toContain(
          "Do not append or move omitted coverage aliases into support or counter fields",
        );
      }
      return new Response(JSON.stringify({
        content: [{
          type: "tool_use",
          name: request.tool_choice.name,
          input: {
            axes: [{
              axis: "F1_identity_verifiability",
              score: 10,
              rationale: "Identity is supported while coverage gaps remain explicit.",
              primaryEvidenceRef: substantiveAlias,
              additionalEvidenceRefs: [],
              counterEvidenceRefs: [],
              coverageRefs: attempt === 1
                ? [...coverageCandidates, omittedCoverageAlias]
                : coverageCandidates,
              gaps: ["Some identity and background checks had limited coverage."],
            }],
            headline: "Identity is supported with disclosed coverage limits.",
            identity_note: "Identity resolved from the collected profile evidence.",
          },
        }],
        stop_reason: "tool_use",
        usage: { input_tokens: 100, output_tokens: 20 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const verdict = await analyzeSubject("@subject", ["FOUNDER"], singleAxisCatalog, evidenceJson);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Only coverage rows semantically tied to the explicit gap are axis-linked;
    // the rest remain available in the frozen evidence catalog.
    expect(verdict?.axes[0].evidenceRefs).toHaveLength(3);

    const nonPreferredCoverage = validateAnalystVerdict({
      axes: [{
        axis: "F1_identity_verifiability",
        score: 10,
        rationale: "Identity is supported with one different eligible coverage gap.",
        primaryEvidenceRef: substantiveAlias,
        additionalEvidenceRefs: [],
        counterEvidenceRefs: [],
        coverageRefs: [omittedCoverageAlias],
        gaps: ["One eligible identity check had limited coverage."],
      }],
      headline: "Identity is supported with a disclosed coverage limit.",
      identity_note: "Identity resolved from the collected profile evidence.",
    }, singleAxisCatalog, scorerCatalog);
    expect(nonPreferredCoverage?.axes[0].evidenceRefs).toHaveLength(1);
  });

  it("skips semantic repair when the route cannot preserve its finalization reserve", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
    const evidenceJson = buildScoringEvidencePacket({
      profile: {
        handle: "@subject",
        display_name: "Subject",
        bio: "Named builder",
        profile_collection_state: "resolved",
        profile_provider: "twitterapi",
      },
      ventures: [{ project_name: "Verified Venture", role: "founder", outcome: "Active" }],
    }, catalog);
    const scorerCatalog = extractScoringEvidenceCatalog(evidenceJson);
    const aliasFor = (axis: string) => {
      const index = scorerCatalog.findIndex((artifact) =>
        artifact.verification !== "unavailable"
        && artifact.verification !== "checked_empty"
        && artifact.eligibleAxes.includes(axis));
      return `e${String(index + 1).padStart(3, "0")}`;
    };
    const f1Alias = aliasFor("F1_identity_verifiability");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      content: [{
        type: "tool_use",
        name: "record_verdict",
        input: {
          axes: [
            {
              axis: "F1_identity_verifiability",
              score: 10,
              rationale: "named identity",
              primaryEvidenceRef: f1Alias,
              additionalEvidenceRefs: [f1Alias],
              counterEvidenceRefs: [],
              coverageRefs: [],
              gaps: [],
            },
            {
              axis: "F2_track_record",
              score: 20,
              rationale: "documented history",
              primaryEvidenceRef: aliasFor("F2_track_record"),
              additionalEvidenceRefs: [],
              counterEvidenceRefs: [],
              coverageRefs: [],
              gaps: [],
            },
          ],
          headline: "Evidence-backed result",
          identity_note: "Identity resolved",
        },
      }],
      stop_reason: "tool_use",
      usage: { input_tokens: 100, output_tokens: 20 },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const verdict = await analyzeSubject("@subject", ["FOUNDER"], catalog, evidenceJson, {
      analystDeadlineAt: Date.now() + ANALYST_REPAIR_TIMEOUT_MS - 1,
    });

    expect(verdict).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "[agent-runtime]",
      expect.stringContaining("repair_skipped_budget"),
    );
  });

  it("skips a late first scoring attempt to preserve the finalization reserve", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
    const evidenceJson = buildScoringEvidencePacket({
      profile: {
        handle: "@subject",
        display_name: "Subject",
        bio: "Named builder",
        profile_collection_state: "resolved",
        profile_provider: "twitterapi",
      },
      ventures: [{ project_name: "Verified Venture", role: "founder", outcome: "Active" }],
    }, catalog);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const verdict = await analyzeSubject("@subject", ["FOUNDER"], catalog, evidenceJson, {
      analystDeadlineAt: Date.now() + 500,
    });

    expect(verdict).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      "[agent-runtime]",
      expect.stringContaining("scoring_skipped_budget"),
    );
  });

  it("fails closed after exhausting every invalid semantic repair attempt", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
    const evidenceJson = buildScoringEvidencePacket({
      profile: {
        handle: "@subject",
        display_name: "Subject",
        bio: "Named builder",
        profile_collection_state: "resolved",
        profile_provider: "twitterapi",
      },
      ventures: [{ project_name: "Verified Venture", role: "founder", outcome: "Active" }],
    }, catalog);
    const scorerCatalog = extractScoringEvidenceCatalog(evidenceJson);
    const aliasFor = (axis: string) => {
      const index = scorerCatalog.findIndex((artifact) =>
        artifact.verification !== "unavailable"
        && artifact.verification !== "checked_empty"
        && artifact.eligibleAxes.includes(axis));
      return `e${String(index + 1).padStart(3, "0")}`;
    };
    const f1Alias = aliasFor("F1_identity_verifiability");
    const invalidInput = {
      axes: [
        {
          axis: "F1_identity_verifiability",
          score: 10,
          rationale: "named identity",
          primaryEvidenceRef: f1Alias,
          additionalEvidenceRefs: [f1Alias],
          counterEvidenceRefs: [],
          coverageRefs: [],
          gaps: [],
        },
        {
          axis: "F2_track_record",
          score: 20,
          rationale: "documented history",
          primaryEvidenceRef: aliasFor("F2_track_record"),
          additionalEvidenceRefs: [],
          counterEvidenceRefs: [],
          coverageRefs: [],
          gaps: [],
        },
      ],
      headline: "Evidence-backed result",
      identity_note: "Identity resolved",
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      content: [{ type: "tool_use", name: "record_verdict", input: invalidInput }],
      stop_reason: "tool_use",
      usage: { input_tokens: 100, output_tokens: 20 },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    await expect(analyzeSubject("@subject", ["FOUNDER"], catalog, evidenceJson)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("does not semantic-repair a max-token completion failure", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
    const evidenceJson = buildScoringEvidencePacket({
      profile: {
        handle: "@subject",
        display_name: "Subject",
        bio: "Named builder",
        profile_collection_state: "resolved",
        profile_provider: "twitterapi",
      },
      ventures: [{ project_name: "Verified Venture", role: "founder", outcome: "Active" }],
    }, catalog);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      content: [{ type: "tool_use", name: "record_verdict", input: {} }],
      stop_reason: "max_tokens",
      usage: { input_tokens: 100, output_tokens: 6000 },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    await expect(analyzeSubject("@subject", ["FOUNDER"], catalog, evidenceJson)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives the citation-rich flagship scorer a dedicated 180 second window", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
    const evidenceJson = buildScoringEvidencePacket({
      profile: {
        handle: "@subject",
        display_name: "Subject",
        bio: "Named builder",
        profile_collection_state: "resolved",
        profile_provider: "twitterapi",
      },
      ventures: [{
        project_name: "Verified Venture",
        role: "founder",
        outcome: "Active",
        artifact_verified: true,
      }],
    }, catalog);
    const signal = new AbortController().signal;
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(signal);
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(analyzeSubject("@subject", ["FOUNDER"], catalog, evidenceJson)).resolves.toBeNull();

    // Each transient (transport) attempt gets the full dedicated scoring window;
    // a persistent transport failure exhausts the bounded retries then gives up.
    expect(ANALYST_SCORING_TIMEOUT_MS).toBe(180_000);
    expect(timeoutSpy).toHaveBeenCalledWith(ANALYST_SCORING_TIMEOUT_MS);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("falls back from an Anthropic 400 to a valid Grok JSON-schema verdict ONLY when failover is opted in", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
    vi.stubEnv("XAI_API_KEY", "xai-test-key");
    vi.stubEnv("ARGUS_PROVIDER_FALLBACKS", "on");
    const evidenceJson = buildScoringEvidencePacket({
      profile: {
        handle: "@subject",
        display_name: "Subject",
        bio: "Named builder",
        profile_collection_state: "resolved",
        profile_provider: "twitterapi",
      },
      ventures: [{
        project_name: "Verified Venture",
        role: "founder",
        outcome: "Active",
        artifact_verified: true,
      }],
    }, catalog);
    const scorerCatalog = extractScoringEvidenceCatalog(evidenceJson, catalog);
    const aliasFor = (axis: string) => {
      const index = scorerCatalog.findIndex((artifact) =>
        artifact.verification !== "unavailable"
        && artifact.verification !== "checked_empty"
        && artifact.eligibleAxes.includes(axis));
      expect(index).toBeGreaterThanOrEqual(0);
      return `e${String(index + 1).padStart(3, "0")}`;
    };
    const grokVerdict = {
      axes: [
        {
          axis: "F1_identity_verifiability",
          score: 10,
          rationale: "The resolved provider profile names the subject.",
          primaryEvidenceRef: aliasFor("F1_identity_verifiability"),
          additionalEvidenceRefs: [],
          counterEvidenceRefs: [],
          coverageRefs: [],
          gaps: [],
        },
        {
          axis: "F2_track_record",
          score: 20,
          rationale: "The frozen venture record documents an active operating history.",
          primaryEvidenceRef: aliasFor("F2_track_record"),
          additionalEvidenceRefs: [],
          counterEvidenceRefs: [],
          coverageRefs: [],
          gaps: [],
        },
      ],
      headline: "Verified profile and venture evidence support the founder assessment.",
      identity_note: "Collected profile evidence resolves the subject's public identity.",
    };
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://api.anthropic.com/v1/messages") {
        return new Response(JSON.stringify({
          type: "error",
          error: { type: "invalid_request_error", message: "Credit balance is too low." },
        }), { status: 400, headers: { "content-type": "application/json" } });
      }
      if (url === "https://api.x.ai/v1/chat/completions") {
        const request = JSON.parse(String(init?.body)) as {
          messages?: Array<{ role?: string; content?: string }>;
          response_format?: {
            type?: string;
            json_schema?: { name?: string; strict?: boolean; schema?: unknown };
          };
        };
        expect(request.messages?.find((message) => message.role === "user")?.content)
          .toContain("Axes to score");
        expect(request.response_format).toEqual({
          type: "json_schema",
          json_schema: {
            name: "record_verdict",
            strict: true,
            schema: RECORD_VERDICT_INPUT_SCHEMA,
          },
        });
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify(grokVerdict) } }],
          usage: { prompt_tokens: 120, completion_tokens: 40 },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`unexpected provider URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    const captured = await withCostLedger(async () => {
      const verdict = await analyzeSubject("@subject", ["FOUNDER"], catalog, evidenceJson);
      return { verdict, cost: getCost() };
    });

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "https://api.anthropic.com/v1/messages",
      "https://api.x.ai/v1/chat/completions",
    ]);
    expect(captured.verdict?.axes.map((axis) => axis.axis)).toEqual([
      "F1_identity_verifiability",
      "F2_track_record",
    ]);
    expect(captured.cost.claudeCalls).toBe(1);
    expect(captured.cost.grokCalls).toBe(1);
    expect(captured.cost.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        provider: "claude",
        op: "record_verdict",
        calls: 1,
        failed: 1,
        meta: expect.stringContaining("http_400"),
      }),
      expect.objectContaining({
        provider: "grok",
        op: "record_verdict",
        calls: 1,
        succeeded: 1,
      }),
    ]));
  });

  it("by default a failed Anthropic call fails VISIBLY: no Grok retry, failure in the ledger", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
    vi.stubEnv("XAI_API_KEY", "xai-test-key");
    const evidenceJson = buildScoringEvidencePacket({
      profile: {
        handle: "@subject",
        display_name: "Subject",
        bio: "Named builder",
        profile_collection_state: "resolved",
        profile_provider: "twitterapi",
      },
      ventures: [{
        project_name: "Verified Venture",
        role: "founder",
        outcome: "Active",
        artifact_verified: true,
      }],
    }, catalog);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({      type: "error",
      error: { type: "invalid_request_error", message: "Credit balance is too low." },
    }), { status: 400, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { verdict, cost } = await withCostLedger(async () => ({
      verdict: await analyzeSubject("@subject", ["FOUNDER"], catalog, evidenceJson),
      cost: getCost(),
    }));

    expect(verdict).toBeNull();
    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls.every((url) => url === "https://api.anthropic.com/v1/messages")).toBe(true);
    expect(cost.grokCalls).toBe(0);
    expect(cost.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        provider: "claude",
        op: "record_verdict",
        failed: 1,
        meta: expect.stringContaining("http_400"),
      }),
    ]));
  });
});

describe("AI analyst attempt accounting", () => {
  const tool = {
    name: "record_test",
    description: "Record a test result.",
    input_schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("is available with Grok as the only configured analyst provider", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("XAI_API_KEY", "xai-test-key");

    expect(analystAvailable()).toBe(true);
  });

  it("records an HTTP failure as a failed paid attempt", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const captured = await withCostLedger(async () => {
      const result = await structured<{ ok: boolean }>("system", "user", tool);
      return { result, cost: getCost() };
    });

    expect(captured.result).toBeNull();
    expect(captured.cost.claudeCalls).toBe(1);
    expect(captured.cost.calls).toContainEqual(expect.objectContaining({
      provider: "claude",
      op: "record_test",
      calls: 1,
      failed: 1,
      status: "failed",
      usd: 0,
      meta: expect.stringContaining("http_503"),
    }));
  });

  it("classifies an Anthropic grammar compilation rejection", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      type: "error",
      error: {
        type: "invalid_request_error",
        message: "Schema is too complex for compilation.",
      },
    }), { status: 400, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const captured = await withCostLedger(async () => {
      const result = await structured<{ ok: boolean }>("system", "user", tool);
      return { result, cost: getCost() };
    });

    expect(captured.result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(captured.cost.calls).toContainEqual(expect.objectContaining({
      provider: "claude",
      op: "record_test",
      failed: 1,
      status: "failed",
      meta: expect.stringContaining("schema_too_complex"),
    }));
    expect(infoSpy).toHaveBeenCalledWith(
      "[agent-call]",
      expect.stringContaining('"failure":"schema_too_complex"'),
    );
  });

  it("bounds the Anthropic request at 60 seconds by default", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
    const signal = new AbortController().signal;
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(signal);
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const captured = await withCostLedger(async () => {
      const result = await structured<{ ok: boolean }>("system", "user", tool);
      return { result, cost: getCost() };
    });

    expect(captured.result).toBeNull();
    expect(timeoutSpy).toHaveBeenCalledWith(60_000);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal }),
    );
    expect(captured.cost.calls).toContainEqual(expect.objectContaining({
      provider: "claude",
      op: "record_test",
      failed: 1,
      status: "failed",
      meta: expect.stringContaining("transport_error"),
    }));
  });

  it("records the tool and dedicated timeout when a request expires", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("timed out", "TimeoutError")));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const captured = await withCostLedger(async () => {
      const result = await structured<{ ok: boolean }>("system", "user", tool, 2048, 120_000);
      return { result, cost: getCost() };
    });

    expect(captured.result).toBeNull();
    expect(captured.cost.calls).toContainEqual(expect.objectContaining({
      provider: "claude",
      op: "record_test",
      failed: 1,
      meta: expect.stringContaining("timeout_120000ms"),
    }));
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("record_test request failed (timeout_120000ms)"),
      expect.objectContaining({ name: "TimeoutError" }),
    );
  });

  it("records billed usage as partial when the required tool result is missing", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      content: [{ type: "text", text: "not a tool call" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1_000, output_tokens: 100 },
    }), { status: 200, headers: { "content-type": "application/json" } })));

    const captured = await withCostLedger(async () => {
      const result = await structured<{ ok: boolean }>("system", "user", tool);
      return { result, cost: getCost() };
    });

    expect(captured.result).toBeNull();
    expect(captured.cost.calls).toContainEqual(expect.objectContaining({
      provider: "claude",
      calls: 1,
      succeeded: 0,
      partial: 1,
      failed: 0,
      status: "partial",
      meta: expect.stringContaining("stop_reason_end_turn"),
    }));
  });

  it("rejects ambiguous duplicate tool calls even when one could be parsed", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      content: [
        { type: "tool_use", name: "record_test", input: { ok: true } },
        { type: "tool_use", name: "record_test", input: { ok: false } },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 1_000, output_tokens: 100 },
    }), { status: 200, headers: { "content-type": "application/json" } })));

    const captured = await withCostLedger(async () => {
      const result = await structured<{ ok: boolean }>("system", "user", tool);
      return { result, cost: getCost() };
    });

    expect(captured.result).toBeNull();
    expect(captured.cost.calls).toContainEqual(expect.objectContaining({
      status: "partial",
      meta: expect.stringContaining("ambiguous_tool_use"),
    }));
  });

  it("rejects a tool block when generation stopped for max tokens", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      content: [{ type: "tool_use", name: "record_test", input: { ok: true } }],
      stop_reason: "max_tokens",
      usage: { input_tokens: 1_000, output_tokens: 100 },
    }), { status: 200, headers: { "content-type": "application/json" } })));

    const captured = await withCostLedger(async () => {
      const result = await structured<{ ok: boolean }>("system", "user", tool);
      return { result, cost: getCost() };
    });

    expect(captured.result).toBeNull();
    expect(captured.cost.calls).toContainEqual(expect.objectContaining({
      status: "partial",
      meta: expect.stringContaining("stop_reason_max_tokens"),
    }));
  });
});

describe("blue-chip evidence recall (report UX overhaul)", () => {
  const p4Axes: AnalystAxis[] = [{ axis: "P4_backing_and_partners", weight: 14, role: SubjectClass.PROJECT }];
  const pressArtifact = (title: string, hash: string) => ({
    kind: "press",
    provider: "google-news",
    title,
    excerpt: title,
    sourceUrl: `https://news.example/${hash}`,
    capturedAt: "2026-07-12T12:00:00.000Z",
    publishedAt: "2026-07-10T12:00:00.000Z",
    contentHash: hash.repeat(64).slice(0, 64),
    match: "exact_handle" as const,
  });

  it("counts transitive counterparty verbs (adopts, expands + object) as relationship press", () => {
    // Both headlines cover ONE Aave-Chainlink story, so the syndication dedupe
    // correctly yields a single relationship key: solid, not exceptional.
    // Before the verb fix these headlines counted as zero relationship press.
    const packet = buildScoringEvidencePacket({
      sourceArtifacts: [
        pressArtifact("Aave Expands Chainlink CCIP for Cross-Chain Actions", "a"),
        pressArtifact("Aave adopts Chainlink CCIP for crosschain transfers", "b"),
      ],
    }, p4Axes);
    expect(deriveProjectStrengthBands(packet, p4Axes).P4_backing_and_partners.tier).toBe("solid");
    const noPress = buildScoringEvidencePacket({ sourceArtifacts: [] }, p4Axes);
    const noPressTier = deriveProjectStrengthBands(noPress, p4Axes).P4_backing_and_partners.tier;
    expect(noPressTier === "none" || noPressTier === "emerging").toBe(true);
  });

  it("never counts self-referential deployment phrasing as a counterparty relationship", () => {
    const packet = buildScoringEvidencePacket({
      sourceArtifacts: [
        pressArtifact("RugX goes live on BSC", "c"),
        pressArtifact("RugX expands to Base", "d"),
        pressArtifact("RugX extends its lead on Solana", "e"),
      ],
    }, p4Axes);
    const band = deriveProjectStrengthBands(packet, p4Axes).P4_backing_and_partners;
    expect(band.tier === "none" || band.tier === "emerging").toBe(true);
  });

  it("rejects a P4 gap claiming partnership evidence was not collected while relationship press is frozen", () => {
    const p4Support = `art_v1_${"e".repeat(64)}`;
    const pressRef = `art_v1_${"f".repeat(64)}`;
    const evidence = [
      axisArtifact(p4Support, ["P4_backing_and_partners"]),
      {
        ...axisArtifact(pressRef, ["P4_backing_and_partners"]),
        title: "Aave adopts Chainlink CCIP for crosschain transfers",
        excerpt: "Aave adopts Chainlink CCIP.",
      },
    ];
    const payload = (gap: string) => ({
      axes: [{
        ...validAxis("P4_backing_and_partners", 10, p4Support),
        gaps: [gap],
      }],
      headline: "Evidence-backed project result",
      identity_note: "Named team is verified",
    });
    const rejection = vi.fn();
    expect(validateAnalystVerdict(
      payload("Direct counterparty confirmation of ecosystem integration partnerships was not collected."),
      p4Axes, evidence, rejection,
    )).toBeNull();
    expect(rejection).toHaveBeenLastCalledWith(
      "relationship-press-described-as-uncollected:P4_backing_and_partners",
    );
    // Named-partner verification failures survive: they are honest gaps.
    expect(validateAnalystVerdict(
      payload("A claimed Binance partnership could not be verified from available sources."),
      p4Axes, evidence, undefined,
    )).not.toBeNull();
  });

  it("lifts P5 to exceptional on multi-year billion-scale TVL history and still demotes on a severe drawdown", () => {
    const p5Axes: AnalystAxis[] = [{ axis: "P5_traction_and_liveness", weight: 14, role: SubjectClass.PROJECT }];
    const base = {
      profile: {
        handle: "@aave",
        display_name: "Aave",
        days_since_post: 0,
        profile_collection_state: "resolved" as const,
        profile_provider: "twitterapi",
        profile_captured_at: "2026-07-12T20:00:00.000Z",
      },
      basicFacts: [{
        predicate: "traction",
        value: "$14.0B total value locked (Ethereum, Plasma, Arbitrum)",
        qualifier: "captured 2026-07-12",
        status: "verified" as const,
        artifact_verified: true,
        excerpt: "Aave holds $14.0B in total value locked. TVL history since 2020.",
      }],
      projectToken: {
        verified: true as const,
        verification: "official_x" as const,
        name: "Aave",
        symbol: "AAVE",
        coingeckoId: "aave",
        rank: 52,
        address: "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9",
        chain: "ethereum",
        sourceUrl: "https://www.coingecko.com/en/coins/aave",
        capturedAt: "2026-07-12T20:00:00.000Z",
        providers: ["coingecko", "dexscreener"] as Array<"coingecko" | "dexscreener" | "geckoterminal">,
        marketCapUsd: 1_500_000_000,
        volume24hUsd: 218_000_000,
        liquidityUsd: 13_600_000,
      },
    };
    const longevityPacket = buildScoringEvidencePacket(base, p5Axes);
    expect(deriveProjectStrengthBands(longevityPacket, p5Axes).P5_traction_and_liveness.tier).toBe("exceptional");

    const drawdownPacket = buildScoringEvidencePacket({
      ...base,
      findings: [{
        finding_type: "ProjectTokenDrawdown",
        claim: "The canonical token fell more than 70 percent from its recorded peak.",
        source_url: "https://geckoterminal.example/ohlcv",
        verification_status: "Verified",
        polarity: -1,
        evidence_origin: "deterministic",
        artifact_verified: true,
      }],
    }, p5Axes);
    expect(deriveProjectStrengthBands(drawdownPacket, p5Axes).P5_traction_and_liveness.tier).toBe("solid");
  });
});

// The persist boundary rejects any non-none band whose reasons array is empty
// (strictStringArray min 1). The live P4 investor-only path shipped exactly
// that once and killed the immutable save; every band must now carry at least
// one reason for every tier the evidence can produce.
describe("project band reasons contract (failed-persist regression)", () => {
  it("an investor-only P4 band carries a reason for its solid tier", async () => {
    const { buildScoringEvidencePacket, deriveProjectStrengthBands } = await import("./agent");
    const { getProfile, SubjectClass } = await import("../src/engine");
    const axes = Object.entries(getProfile(SubjectClass.PROJECT).axes)
      .map(([axis, weight]) => ({ axis, weight, role: SubjectClass.PROJECT }));
    const packet = buildScoringEvidencePacket({
      basicFacts: [
        { predicate: "investor", value: "Named venture backer disclosed", status: "verified", artifact_verified: true },
      ],
    }, axes);
    const bands = deriveProjectStrengthBands(packet, axes);
    const p4 = bands.P4_backing_and_partners;
    expect(p4.tier).not.toBe("none");
    expect(p4.reasons.length).toBeGreaterThanOrEqual(1);
    expect(p4.reasons).toContain("1 verified investor record");
  });

  it("a verified operating partnership supports P4 and carries its artifact", async () => {
    const { buildScoringEvidencePacket, deriveProjectStrengthBands } = await import("./agent");
    const { getProfile, SubjectClass } = await import("../src/engine");
    const axes = Object.entries(getProfile(SubjectClass.PROJECT).axes)
      .map(([axis, weight]) => ({ axis, weight, role: SubjectClass.PROJECT }));
    const packet = buildScoringEvidencePacket({
      basicFacts: [{
        predicate: "partnership",
        value: "Pyth Network",
        status: "verified",
        artifact_verified: true,
        artifactId: "basic-fact:partnership:pyth",
      }],
    }, axes);
    const packetFact = (JSON.parse(packet) as { basicFacts: Array<{ artifactId: string }> }).basicFacts[0];
    const p4 = deriveProjectStrengthBands(packet, axes).P4_backing_and_partners;

    expect(p4.tier).toBe("solid");
    expect(p4.reasons).toContain("1 verified operating relationship");
    expect(p4.anchorArtifactIds).toContain(packetFact.artifactId);
  });

  it("every derived band satisfies the persist contract: reasons for non-none tiers, unique, capped", async () => {
    const { buildScoringEvidencePacket, deriveProjectStrengthBands } = await import("./agent");
    const { getProfile, SubjectClass } = await import("../src/engine");
    const axes = Object.entries(getProfile(SubjectClass.PROJECT).axes)
      .map(([axis, weight]) => ({ axis, weight, role: SubjectClass.PROJECT }));
    const packets = [
      buildScoringEvidencePacket({ basicFacts: [] }, axes),
      buildScoringEvidencePacket({
        basicFacts: [
          { predicate: "investor", value: "Backer A", status: "verified", artifact_verified: true },
          { predicate: "funding", value: "$100M Series C round", status: "verified", artifact_verified: true },
          { predicate: "governance", value: "Token-holder governance", status: "verified", artifact_verified: true },
          { predicate: "traction", value: "$5B locked", status: "verified", artifact_verified: true },
        ],
      }, axes),
    ];
    for (const packet of packets) {
      for (const [axis, band] of Object.entries(deriveProjectStrengthBands(packet, axes))) {
        if (band.tier !== "none") {
          expect(band.reasons.length, `${axis} reasons`).toBeGreaterThanOrEqual(1);
        }
        expect(band.reasons.length).toBeLessThanOrEqual(12);
        expect(new Set(band.reasons).size).toBe(band.reasons.length);
        for (const reason of band.reasons) {
          expect(reason.length).toBeLessThanOrEqual(240);
          expect(reason.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });
});
