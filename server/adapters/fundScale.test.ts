import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyEvidence } from "../../src/data/evidence";
import { SubjectClass } from "../../src/engine";
import { isStrictFundScaleArtifact } from "../../src/lib/fundScaleEvidence";
import { getCost, withCostLedger } from "../cost";
import type { PublicTextDocument, PublicTextResult } from "../publicWeb";
import type { CollectContext } from "./types";
import {
  collectFundScale,
  discoverFundScaleCandidates,
  isRegulatoryRecordUrl,
  parseFundScaleCandidates,
  parseUsdAmounts,
  supportsFundScaleClaim,
  type FundScaleLead,
} from "./fundScale";
import { collectPortfolioRelationships, discoverPortfolioCandidates } from "./portfolio";

const NOW = new Date("2026-07-11T12:00:00.000Z");
const SEC_RECORD_URL = "https://www.sec.gov/Archives/edgar/data/1234567/000123456726000001/fund.htm";
const FCA_RECORD_URL = "https://register.fca.org.uk/firm/details/123456";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const lead = (overrides: Partial<FundScaleLead> = {}): FundScaleLead => ({
  fundName: "Paradigm",
  fundHandle: "@paradigm",
  attribution: "direct_subject",
  amountHintUsd: 999_000_000,
  sources: [{ url: "https://paradigm.xyz/2024/fund" }],
  evidence_origin: "model_lead",
  artifact_verified: false,
  provider: "grok",
  ...overrides,
});

const document = (overrides: Partial<PublicTextDocument> = {}): PublicTextDocument => ({
  status: "ok",
  url: "https://paradigm.xyz/2024/fund",
  host: "paradigm.xyz",
  contentType: "text/html",
  text: "<html><body><p>We announced a new $850 million venture fund.</p></body></html>",
  contentHash: "a".repeat(64),
  capturedAt: NOW.toISOString(),
  ...overrides,
});

function context(handle = "@paradigm", displayName = "Paradigm") {
  const evidence = emptyEvidence(handle);
  evidence.profile.display_name = displayName;
  evidence.profile.website = handle === "@paradigm" ? "https://paradigm.xyz" : undefined;
  evidence.profile.profile_collection_state = "resolved";
  evidence.profile.profile_provider = "twitterapi";
  evidence.profile.profile_captured_at = NOW.toISOString();
  evidence.roles = [SubjectClass.INVESTOR];
  const ctx: CollectContext = { handle, evidence, emit: vi.fn() };
  return { ctx, evidence };
}

describe("fund-scale discovery parsing", () => {
  it("keeps bounded source leads and drops credential-bearing URLs", () => {
    const parsed = parseFundScaleCandidates(JSON.stringify({
      investments: [],
      fund_scale: [{
        fund_name: "Paradigm",
        fund_vehicle: "Fund III",
        fund_x_handle: "@paradigm",
        amount_hint_usd: 850_000_000,
        sources: [
          { url: "https://paradigm.xyz/fund", title: "Fund announcement" },
          { url: "http://127.0.0.1/private" },
          { url: "https://example.com/fund?X-Amz-Signature=secret" },
        ],
      }],
    }));
    expect(parsed).toEqual([expect.objectContaining({
      fundName: "Paradigm",
      fundVehicleHint: "Fund III",
      amountHintUsd: 850_000_000,
      sources: [{ url: "https://paradigm.xyz/fund", title: "Fund announcement" }],
      evidence_origin: "model_lead",
      artifact_verified: false,
    })]);
  });

  it("uses focused discovery when shared candidates contain only rejected URLs", async () => {
    vi.stubEnv("XAI_API_KEY", "xai-test-key");
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const response = (output: unknown) => new Response(JSON.stringify({
      output_text: JSON.stringify(output),
      output: [{ type: "web_search_call" }],
      usage: { input_tokens: 10, output_tokens: 10 },
    }), { status: 200, headers: { "content-type": "application/json" } });
    const portfolioFetch = vi.fn()
      .mockResolvedValueOnce(response({ investments: [{ project: "Acme", sources: [{ url: "https://example.com/private?token=secret" }] }], fund_scale: [] }))
      .mockResolvedValueOnce(response({ investments: [{ project: "Acme", sources: [{ url: "https://paradigm.xyz/portfolio/acme" }] }] }));
    vi.stubGlobal("fetch", portfolioFetch);
    await expect(discoverPortfolioCandidates(context().ctx)).resolves.toEqual([
      expect.objectContaining({ projectName: "Acme", sources: [{ url: "https://paradigm.xyz/portfolio/acme" }] }),
    ]);
    expect(portfolioFetch).toHaveBeenCalledTimes(2);

    const fundFetch = vi.fn()
      .mockResolvedValueOnce(response({ investments: [], fund_scale: [{ fund_name: "Paradigm", sources: [{ url: "https://example.com/private?token=secret" }] }] }))
      .mockResolvedValueOnce(response({ fund_scale: [{ fund_name: "Paradigm", sources: [{ url: "https://paradigm.xyz/fund" }] }] }));
    vi.stubGlobal("fetch", fundFetch);
    await expect(discoverFundScaleCandidates(context().ctx)).resolves.toEqual([
      expect.objectContaining({ fundName: "Paradigm", sources: [{ url: "https://paradigm.xyz/fund" }] }),
    ]);
    expect(fundFetch).toHaveBeenCalledTimes(2);
  });

  it("preserves mixed source coverage without running a focused fallback", async () => {
    vi.stubEnv("XAI_API_KEY", "xai-test-key");
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output_text: JSON.stringify({
        investments: [
          { project: "Acme", sources: [{ url: "https://paradigm.xyz/portfolio/acme" }] },
          { project: "Uncited portfolio lead", sources: [{ url: "https://example.com/private?token=secret" }] },
        ],
        fund_scale: [
          { fund_name: "Paradigm", sources: [{ url: "https://paradigm.xyz/fund" }] },
          { fund_name: "Uncited Fund", sources: [{ url: "https://example.com/private?token=secret" }] },
        ],
      }),
      output: [{ type: "web_search_call" }],
      usage: { input_tokens: 10, output_tokens: 10 },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { ctx } = context();

    await expect(discoverPortfolioCandidates(ctx)).resolves.toEqual([
      expect.objectContaining({ projectName: "Acme", sources: [expect.any(Object)] }),
      expect.objectContaining({ projectName: "Uncited portfolio lead", sources: [] }),
    ]);
    await expect(discoverFundScaleCandidates(ctx)).resolves.toEqual([
      expect.objectContaining({ fundName: "Paradigm", sources: [expect.any(Object)] }),
      expect.objectContaining({ fundName: "Uncited Fund", sources: [] }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("runs only the focused portfolio fallback when shared investments are empty", async () => {
    vi.stubEnv("XAI_API_KEY", "xai-test-key");
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        output_text: JSON.stringify({
          investments: [],
          fund_scale: [{ fund_name: "Paradigm", sources: [{ url: "https://paradigm.xyz/fund" }] }],
        }),
        output: [{ type: "web_search_call" }],
        usage: { input_tokens: 10, output_tokens: 10 },
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        output_text: JSON.stringify({
          investments: [{
            project: "Acme",
            investor_entity: "Paradigm",
            attribution: "direct_subject",
            sources: [{ url: "https://paradigm.xyz/portfolio/acme" }],
          }],
        }),
        output: [{ type: "web_search_call" }],
        usage: { input_tokens: 10, output_tokens: 10 },
      }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { ctx } = context();

    const cost = await withCostLedger(async () => {
      await expect(discoverPortfolioCandidates(ctx)).resolves.toEqual([
        expect.objectContaining({ projectName: "Acme", investorEntityName: "Paradigm", attribution: "direct_subject" }),
      ]);
      await expect(discoverPortfolioCandidates(ctx)).resolves.toHaveLength(1);
      await expect(discoverFundScaleCandidates(ctx)).resolves.toHaveLength(1);
      return getCost();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(cost.grokCalls).toBe(2);
    expect(cost.calls).toContainEqual(expect.objectContaining({ provider: "grok", op: "live-search", calls: 2 }));
    const requests = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as {
      input: { content: string }[];
      max_tool_calls?: number;
    });
    expect(requests[0].input[0].content).toContain("both arrays");
    expect(requests[1].input[0].content).toContain("public investment relationships");
    expect(requests[1].input[0].content).not.toContain("public fund-scale evidence");
    expect(requests[1].max_tool_calls).toBe(12);
  });

  it("runs only the focused fund-scale fallback when shared fund scale is empty", async () => {
    vi.stubEnv("XAI_API_KEY", "xai-test-key");
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        output_text: JSON.stringify({
          investments: [{ project: "Acme", sources: [{ url: "https://paradigm.xyz/portfolio/acme" }] }],
          fund_scale: [],
        }),
        output: [{ type: "web_search_call" }],
        usage: { input_tokens: 10, output_tokens: 10 },
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        output_text: JSON.stringify({
          fund_scale: [{
            fund_name: "Paradigm",
            attribution: "direct_subject",
            metric_hint: "fund_vehicle",
            amount_hint_usd: 850_000_000,
            sources: [{ url: "https://paradigm.xyz/fund" }],
          }],
        }),
        output: [{ type: "web_search_call" }],
        usage: { input_tokens: 10, output_tokens: 10 },
      }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { ctx } = context();

    await expect(discoverPortfolioCandidates(ctx)).resolves.toHaveLength(1);
    await expect(discoverFundScaleCandidates(ctx)).resolves.toEqual([
      expect.objectContaining({
        fundName: "Paradigm",
        attribution: "direct_subject",
        metricHint: "fund_vehicle",
        amountHintUsd: 850_000_000,
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const requests = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as {
      input: { content: string }[];
      max_tool_calls?: number;
    });
    expect(requests[1].input[0].content).toContain("public fund-scale evidence");
    expect(requests[1].input[0].content).not.toContain("public investment relationships");
    expect(requests[1].max_tool_calls).toBe(12);
  });

  it("does not turn a missing shared investments array into a focused search", async () => {
    vi.stubEnv("XAI_API_KEY", "xai-test-key");
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output_text: JSON.stringify({ fund_scale: [] }),
      output: [{ type: "web_search_call" }],
      usage: { input_tokens: 10, output_tokens: 10 },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { ctx } = context();

    await expect(discoverPortfolioCandidates(ctx)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves a focused provider failure as null", async () => {
    vi.stubEnv("XAI_API_KEY", "xai-test-key");
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        output_text: JSON.stringify({ investments: [], fund_scale: [] }),
        output: [{ type: "web_search_call" }],
        usage: { input_tokens: 10, output_tokens: 10 },
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response("upstream unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const { ctx } = context();

    await expect(discoverFundScaleCandidates(ctx)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("USD fund amount parsing", () => {
  it.each([
    ["$850m fund", 850_000_000],
    ["US$1.5bn fund", 1_500_000_000],
    ["USD 850,000,000 fund", 850_000_000],
    ["$75mm fund", 75_000_000],
    ["$2.5 billion fund", 2_500_000_000],
  ])("parses %s", (text, expected) => {
    expect(parseUsdAmounts(text)[0]?.amountUsd).toBe(expected);
  });

  it.each([
    "EUR 850m",
    "GBP 850m",
    "850m",
    "A$850m",
    "A $850m",
    "$850 million CAD fund",
    "$850m (AUD) fund",
    "$850m in CAD fund",
    "$850m, Canadian fund",
    "$75",
  ])('rejects non-USD or ambiguous "%s"', (text) => {
    expect(parseUsdAmounts(text)).toEqual([]);
  });
});

describe("fund-scale semantic matching", () => {
  it("accepts a completed vehicle size and rejects a company round or proposed target", () => {
    expect(supportsFundScaleClaim({
      document: document({ text: "Paradigm announced a new $850 million venture fund." }),
      sourceClass: "independent_press",
      subjectAliases: ["Paradigm"],
      now: NOW,
    })).toContainEqual(expect.objectContaining({ amountUsd: 850_000_000, metric: "fund_vehicle" }));

    expect(supportsFundScaleClaim({
      document: document({ text: "Acme raised $850 million in a Series C led by Paradigm." }),
      sourceClass: "independent_press",
      subjectAliases: ["Paradigm"],
      now: NOW,
    })).toEqual([]);
    expect(supportsFundScaleClaim({
      document: document({ text: "Paradigm is targeting a new $1 billion fund." }),
      sourceClass: "independent_press",
      subjectAliases: ["Paradigm"],
      now: NOW,
    })).toEqual([]);
  });

  it("requires the entity on third-party sources but permits first-person copy on a verified manager domain", () => {
    const doc = document({ text: "We closed our third fund at $850 million." });
    expect(supportsFundScaleClaim({
      document: doc,
      sourceClass: "first_party_subject",
      subjectAliases: ["Paradigm"],
      now: NOW,
    })).toHaveLength(1);
    expect(supportsFundScaleClaim({
      document: doc,
      sourceClass: "independent_press",
      subjectAliases: ["Paradigm"],
      now: NOW,
    })).toEqual([]);
    expect(supportsFundScaleClaim({
      document: document({ text: "Acme announced a new $850 million venture fund." }),
      sourceClass: "first_party_subject",
      subjectAliases: ["Paradigm"],
      now: NOW,
    })).toEqual([]);
    expect(supportsFundScaleClaim({
      document: document({ text: "We announced that Acme closed a new $850 million venture fund." }),
      sourceClass: "first_party_subject",
      subjectAliases: ["Paradigm"],
      now: NOW,
    })).toEqual([]);
    expect(supportsFundScaleClaim({
      document: document({ url: "http://paradigm.xyz/fund", text: "We announced a new $850 million venture fund." }),
      sourceClass: "first_party_subject",
      subjectAliases: ["Paradigm"],
      now: NOW,
    })).toEqual([]);
  });

  it("keeps stale or undated AUM non-confirmable and current dated AUM confirmable", () => {
    const current = supportsFundScaleClaim({
      document: document({
        url: SEC_RECORD_URL,
        host: "sec.gov",
        text: "Paradigm manages $2.5 billion in assets under management as of 1 May 2026.",
      }),
      sourceClass: "public_primary",
      subjectAliases: ["Paradigm"],
      now: NOW,
    });
    expect(current).toContainEqual(expect.objectContaining({
      metric: "regulatory_aum",
      temporalState: "current",
      eligibleForConfirmation: true,
    }));

    const stale = supportsFundScaleClaim({
      document: document({
        url: SEC_RECORD_URL,
        host: "sec.gov",
        text: "Paradigm manages $2.5 billion in assets under management as of January 1, 2022.",
      }),
      sourceClass: "public_primary",
      subjectAliases: ["Paradigm"],
      now: NOW,
    });
    expect(stale).toContainEqual(expect.objectContaining({ temporalState: "historical", eligibleForConfirmation: false }));

    const undated = supportsFundScaleClaim({
      document: document({
        url: SEC_RECORD_URL,
        host: "sec.gov",
        text: "Paradigm manages $2.5 billion in assets under management.",
      }),
      sourceClass: "public_primary",
      subjectAliases: ["Paradigm"],
      now: NOW,
    });
    expect(undated).toContainEqual(expect.objectContaining({ temporalState: "unknown", eligibleForConfirmation: false }));
  });

  it("never substitutes publication time for a claim-local AUM as-of date", () => {
    const matches = supportsFundScaleClaim({
      document: document({
        url: SEC_RECORD_URL,
        host: "sec.gov",
        text: '<script type="application/ld+json">{"datePublished":"2026-07-10"}</script><p>In 2021, Paradigm managed $2.5 billion in assets under management.</p>',
      }),
      sourceClass: "public_primary",
      subjectAliases: ["Paradigm"],
      now: NOW,
    });
    expect(matches).toContainEqual(expect.objectContaining({
      publishedAt: "2026-07-10T00:00:00.000Z",
      temporalState: "unknown",
      eligibleForConfirmation: false,
    }));
    expect(matches[0]?.asOf).toBeUndefined();
  });

  it.each([
    "Paradigm has $850 million in dry powder in its latest fund.",
    "Paradigm invested $850 million through its venture fund.",
    "Paradigm deployed $850 million from its latest venture fund.",
    "Paradigm raised $850 million in a Series C financing from its venture fund.",
  ])("rejects non-scale amount semantics: %s", (text) => {
    expect(supportsFundScaleClaim({
      document: document({ text }),
      sourceClass: "independent_press",
      subjectAliases: ["Paradigm"],
      now: NOW,
    })).toEqual([]);
  });

  it("binds AUM to the correct amount in a multi-amount sentence", () => {
    expect(supportsFundScaleClaim({
      document: document({ text: "Paradigm, with $850 million in dry powder, reports AUM of $2 billion as of January 1, 2026." }),
      sourceClass: "independent_press",
      subjectAliases: ["Paradigm"],
      now: NOW,
    })).toEqual([expect.objectContaining({ amountUsd: 2_000_000_000, metric: "reported_aum" })]);
  });

  it("requires record-specific regulatory URLs", () => {
    expect(isRegulatoryRecordUrl(SEC_RECORD_URL)).toBe(true);
    expect(isRegulatoryRecordUrl(SEC_RECORD_URL.replace("https:", "http:"))).toBe(false);
    expect(isRegulatoryRecordUrl("https://www.sec.gov/newsroom/paradigm-aum")).toBe(false);
    expect(supportsFundScaleClaim({
      document: document({
        url: "https://www.sec.gov/newsroom/paradigm-aum",
        host: "sec.gov",
        text: "Paradigm manages $2.5 billion in assets under management as of January 1, 2026.",
      }),
      sourceClass: "public_primary",
      subjectAliases: ["Paradigm"],
      now: NOW,
    })).toEqual([]);
  });
});

describe("source-backed fund-scale collection", () => {
  it("confirms a first-party fund vehicle and re-derives the fetched amount", async () => {
    const { ctx, evidence } = context();
    const result = await collectFundScale(ctx, {
      discover: async () => [lead()],
      fetchSource: async () => document(),
      now: () => NOW,
    });

    expect(result.state).toBe("executed");
    expect(evidence.sourceArtifacts).toContainEqual(expect.objectContaining({
      kind: "fund_scale",
      provider: "fund-scale-web",
      match: "fund_scale_confirmed",
      fundName: "Paradigm",
      fundSizeUsd: 850_000_000,
      fundVehicle: "Venture Fund",
      fundScaleMetric: "fund_vehicle",
      fundScaleBasis: "manager_reported",
      fundScaleTemporalState: "fixed_historical",
      sourceClass: "first_party_subject",
      sourceContentHash: "a".repeat(64),
      fundScaleClaimId: expect.stringMatching(/^fund_scale_claim_v1_[a-f0-9]{64}$/),
    }));
    expect(evidence.sourceArtifacts[0]?.fundSizeUsd).not.toBe(lead().amountHintUsd);
    expect(isStrictFundScaleArtifact(evidence.sourceArtifacts[0], evidence.sourceArtifacts)).toBe(true);
  });

  it("attributes an employer-page scale lead to the fund without treating its domain as proven", async () => {
    const { ctx, evidence } = context("@gakonst", "Georgios Konstantopoulos");
    evidence.profile.resolved_name = "Georgios Konstantopoulos";
    evidence.profile.bio = "Research Partner at Paradigm";
    const result = await collectFundScale(ctx, {
      discover: async () => [lead({ attribution: "affiliated_fund" })],
      fetchSource: async () => document(),
      resolveInvestorDomain: async () => "paradigm.xyz",
      now: () => NOW,
    });

    expect(result.state).toBe("partial");
    expect(evidence.sourceArtifacts).toContainEqual(expect.objectContaining({
      fundName: "Paradigm",
      investorEntityName: "Paradigm",
      attribution: "affiliated_fund",
      attributionSourceUrl: "https://x.com/gakonst",
      match: "candidate",
    }));
    expect(evidence.sourceArtifacts).not.toContainEqual(expect.objectContaining({ fundName: "Georgios Konstantopoulos" }));
    expect(isStrictFundScaleArtifact(evidence.sourceArtifacts[0], evidence.sourceArtifacts)).toBe(false);
  });

  it("verifies an affiliated fund page when the fund profile freezes an exact official-domain proof", async () => {
    const { ctx, evidence } = context("@gakonst", "Georgios Konstantopoulos");
    evidence.profile.resolved_name = "Georgios Konstantopoulos";
    evidence.profile.bio = "General Partner @paradigm";
    const result = await collectFundScale(ctx, {
      discover: async () => [lead({ attribution: "affiliated_fund", fundVehicleHint: "Venture Fund III" })],
      fetchSource: async () => document({
        url: "https://www.paradigm.xyz/writing/paradigms-third-fund",
        host: "www.paradigm.xyz",
        text: "Paradigm has raised our third fund: an $850M venture fund focused on crypto projects at the earliest stages.",
      }),
      lookupProfile: async () => ({
        handle: "@paradigm",
        name: "Paradigm",
        website: "https://www.paradigm.xyz",
      }),
      now: () => NOW,
    });

    expect(result.state).toBe("executed");
    const artifact = evidence.sourceArtifacts[0];
    expect(artifact).toMatchObject({
      fundName: "Paradigm",
      attribution: "affiliated_fund",
      sourceClass: "first_party_investor",
      match: "fund_scale_confirmed",
      investorEntityDomain: "paradigm.xyz",
      investorDomainSourceUrl: "https://x.com/paradigm",
      investorDomainSourceKind: "provider_profile",
      investorDomainProfileName: "Paradigm",
      investorDomainProfileWebsite: "https://paradigm.xyz/",
    });
    expect(artifact?.investorDomainSourceContentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(isStrictFundScaleArtifact(artifact, evidence.sourceArtifacts, {
      now: NOW,
      subjectHandle: "@gakonst",
      profile: evidence.profile,
    })).toBe(true);
  });

  it("reuses portfolio-frozen fund-domain proof when fund scale runs later in the same audit", async () => {
    const { ctx, evidence } = context("@gakonst", "Georgios Konstantopoulos");
    evidence.profile.resolved_name = "Georgios Konstantopoulos";
    evidence.profile.bio = "General Partner @paradigm";
    const lookupProfile = vi.fn().mockResolvedValue({
      handle: "@paradigm",
      name: "Paradigm",
      website: "https://paradigm.xyz",
    });
    await collectPortfolioRelationships(ctx, {
      discover: async () => [{
        projectName: "Acme Protocol",
        investorEntityName: "Paradigm",
        investorEntityHandle: "@paradigm",
        attribution: "affiliated_fund",
        relationship: "invested_in",
        sources: [{ url: "https://paradigm.xyz/portfolio/acme" }],
        evidence_origin: "model_lead",
        artifact_verified: false,
        provider: "grok",
      }],
      fetchSource: async () => document({ text: "Our portfolio includes Acme Protocol." }),
      lookupProfile,
      now: () => NOW,
    });
    const callsAfterPortfolio = lookupProfile.mock.calls.length;

    const result = await collectFundScale(ctx, {
      discover: async () => [lead({ attribution: "affiliated_fund", fundVehicleHint: "Venture Fund III" })],
      fetchSource: async () => document({
        text: "Paradigm has raised our third fund: an $850M venture fund focused on crypto projects.",
      }),
      lookupProfile,
      now: () => NOW,
    });

    const fundArtifact = evidence.sourceArtifacts.find((artifact) => artifact.kind === "fund_scale");
    expect(result.state).toBe("executed");
    expect(lookupProfile).toHaveBeenCalledTimes(callsAfterPortfolio);
    expect(fundArtifact).toMatchObject({
      match: "fund_scale_confirmed",
      sourceClass: "first_party_investor",
      investorDomainSourceUrl: "https://x.com/paradigm",
      investorDomainProfileWebsite: "https://paradigm.xyz/",
    });
    expect(isStrictFundScaleArtifact(fundArtifact, evidence.sourceArtifacts, {
      now: NOW,
      subjectHandle: "@gakonst",
      profile: evidence.profile,
    })).toBe(true);
  });

  it("confirms current affiliated AUM from a proven first-party fund page", async () => {
    const { ctx, evidence } = context("@gakonst", "Georgios Konstantopoulos");
    evidence.profile.resolved_name = "Georgios Konstantopoulos";
    evidence.profile.bio = "General Partner @paradigm";
    const result = await collectFundScale(ctx, {
      discover: async () => [lead({ attribution: "affiliated_fund", metricHint: "aum" })],
      fetchSource: async () => document({
        url: "https://paradigm.xyz/aum",
        text: "Paradigm manages $2.5 billion in assets under management as of May 1, 2026.",
      }),
      lookupProfile: async () => ({
        handle: "@paradigm",
        name: "Paradigm",
        website: "https://paradigm.xyz",
      }),
      now: () => NOW,
    });

    expect(result.state).toBe("executed");
    expect(evidence.sourceArtifacts).toContainEqual(expect.objectContaining({
      match: "fund_scale_confirmed",
      sourceClass: "first_party_investor",
      fundScaleMetric: "reported_aum",
      fundScaleTemporalState: "current",
      fundSizeUsd: 2_500_000_000,
    }));
  });

  it("rejects account-host paths even when a custom resolver returns their parent host", async () => {
    const { ctx, evidence } = context();
    const result = await collectFundScale(ctx, {
      discover: async () => [lead({ sources: [{ url: "https://github.com/attacker/fake" }] })],
      fetchSource: async () => document({
        url: "https://github.com/attacker/fake",
        host: "github.com",
        text: "Paradigm has raised a new $999 million venture fund.",
      }),
      resolveInvestorDomain: async () => "github.com",
      now: () => NOW,
    });

    expect(result.state).toBe("partial");
    expect(evidence.sourceArtifacts).toContainEqual(expect.objectContaining({
      sourceClass: "other_public",
      match: "candidate",
    }));
    expect(evidence.sourceArtifacts.every((artifact) => !isStrictFundScaleArtifact(artifact, evidence.sourceArtifacts))).toBe(true);
  });

  it("scopes an unknown path-host profile to its exact account path", async () => {
    const { ctx, evidence } = context("@gakonst", "Georgios Konstantopoulos");
    evidence.profile.resolved_name = "Georgios Konstantopoulos";
    evidence.profile.bio = "General Partner @paradigm";
    const result = await collectFundScale(ctx, {
      discover: async () => [lead({
        attribution: "affiliated_fund",
        sources: [{ url: "https://dev.to/attacker/fake-fund-123" }],
      })],
      fetchSource: async () => document({
        url: "https://dev.to/attacker/fake-fund-123",
        host: "dev.to",
        text: "Paradigm has raised a new $999 million venture fund.",
      }),
      lookupProfile: async () => ({
        handle: "@paradigm",
        name: "Paradigm",
        website: "https://dev.to/paradigm",
      }),
      now: () => NOW,
    });

    expect(result.state).toBe("partial");
    expect(evidence.sourceArtifacts).toContainEqual(expect.objectContaining({
      sourceClass: "other_public",
      match: "candidate",
    }));
    expect(evidence.sourceArtifacts.every((artifact) => !isStrictFundScaleArtifact(artifact, evidence.sourceArtifacts, {
      now: NOW,
      subjectHandle: "@gakonst",
      profile: evidence.profile,
    }))).toBe(true);
  });

  it("memoizes official-domain resolution for repeated leads from the same fund", async () => {
    const { ctx } = context();
    const resolveInvestorDomain = vi.fn().mockResolvedValue("paradigm.xyz");
    const fetchSource = vi.fn().mockResolvedValue(document());
    const cost = await withCostLedger(async () => {
      await collectFundScale(ctx, {
        discover: async () => [
          lead(),
          lead({ fundVehicleHint: "Growth Fund" }),
        ],
        fetchSource,
        resolveInvestorDomain,
        now: () => NOW,
      });
      return getCost();
    });

    expect(resolveInvestorDomain).toHaveBeenCalledTimes(1);
    expect(fetchSource).toHaveBeenCalledTimes(1);
    expect(cost.calls).toContainEqual(expect.objectContaining({
      provider: "fund-scale-web",
      op: "source-fetch",
      calls: 1,
    }));
  });

  it("rejects a former employer as the current fund context", async () => {
    const { ctx, evidence } = context("@gakonst", "Georgios Konstantopoulos");
    evidence.profile.resolved_name = "Georgios Konstantopoulos";
    evidence.profile.bio = "Independent researcher; formerly Paradigm";
    await collectFundScale(ctx, {
      discover: async () => [lead({ attribution: "affiliated_fund" })],
      fetchSource: async () => document(),
      now: () => NOW,
    });
    expect(evidence.sourceArtifacts).toEqual([]);
  });

  it("keeps one editorial report as a candidate", async () => {
    const { ctx, evidence } = context();
    await collectFundScale(ctx, {
      discover: async () => [lead({ sources: [{ url: "https://techcrunch.com/paradigm-fund" }] })],
      fetchSource: async () => document({
        url: "https://techcrunch.com/paradigm-fund",
        host: "techcrunch.com",
        text: "Paradigm announced a new $850 million venture fund.",
      }),
      // A profile link to an article does not make the publication first-party.
      resolveInvestorDomain: async () => "techcrunch.com",
      now: () => NOW,
    });
    expect(evidence.sourceArtifacts).toContainEqual(expect.objectContaining({
      kind: "fund_scale",
      match: "candidate",
      sourceClass: "independent_press",
    }));
  });

  it("does not mark a lone press row confirmed merely because first-party evidence shares its claim", async () => {
    const { ctx, evidence } = context();
    const sources = [
      { url: "https://paradigm.xyz/fund-iii" },
      { url: "https://techcrunch.com/paradigm-fund-iii" },
    ];
    await collectFundScale(ctx, {
      discover: async () => [lead({ sources })],
      fetchSource: async (url) => document({
        url,
        host: new URL(url).hostname,
        contentHash: url.includes("techcrunch") ? "b".repeat(64) : "a".repeat(64),
        text: url.includes("techcrunch")
          ? "Paradigm announced Venture Fund III, a new $850 million venture fund."
          : "We announced Venture Fund III, our new $850 million venture fund.",
      }),
      now: () => NOW,
    });
    expect(evidence.sourceArtifacts).toContainEqual(expect.objectContaining({
      sourceClass: "first_party_subject",
      match: "fund_scale_confirmed",
    }));
    expect(evidence.sourceArtifacts).toContainEqual(expect.objectContaining({
      sourceClass: "independent_press",
      match: "candidate",
    }));
  });

  it("confirms two independent editorial reports with agreeing amounts and distinct prose", async () => {
    const { ctx, evidence } = context();
    const sources = [
      { url: "https://techcrunch.com/paradigm-fund" },
      { url: "https://reuters.com/technology/paradigm-fund" },
    ];
    const result = await collectFundScale(ctx, {
      discover: async () => [lead({ sources })],
      fetchSource: async (url) => document({
        url,
        host: new URL(url).hostname,
        contentHash: url.includes("reuters") ? "b".repeat(64) : "a".repeat(64),
        text: url.includes("reuters")
          ? "Paradigm completed fundraising for its third venture fund at $855 million."
          : "Paradigm announced Venture Fund III, a new $850 million venture fund.",
      }),
      resolveInvestorDomain: async () => undefined,
      now: () => NOW,
    });
    expect(result.state).toBe("executed");
    expect(evidence.sourceArtifacts.filter((artifact) => artifact.match === "fund_scale_confirmed")).toHaveLength(2);
    expect(evidence.sourceArtifacts.every((artifact) => artifact.fundScaleSourceCount === 2)).toBe(true);
    expect(new Set(evidence.sourceArtifacts.map((artifact) => artifact.fundVehicle))).toEqual(new Set(["Venture Fund III"]));
    expect(new Set(evidence.sourceArtifacts.map((artifact) => artifact.fundScaleClaimId)).size).toBe(1);
    expect(evidence.sourceArtifacts.every((artifact) => isStrictFundScaleArtifact(artifact, evidence.sourceArtifacts))).toBe(true);
  });

  it("does not corroborate identical syndicated prose or conflicting amounts", async () => {
    for (const mode of ["identical", "conflicting"] as const) {
      const { ctx, evidence } = context();
      const sources = [
        { url: "https://techcrunch.com/paradigm-fund" },
        { url: "https://reuters.com/technology/paradigm-fund" },
      ];
      await collectFundScale(ctx, {
        discover: async () => [lead({ sources })],
        fetchSource: async (url) => document({
          url,
          host: new URL(url).hostname,
          contentHash: url.includes("reuters") ? "b".repeat(64) : "a".repeat(64),
          text: mode === "identical"
            ? "Paradigm announced Venture Fund III, a new $850 million venture fund."
            : url.includes("reuters")
              ? "Paradigm announced Venture Fund III, a new $900 million venture fund."
              : "Paradigm announced Venture Fund III, a new $850 million venture fund.",
        }),
        resolveInvestorDomain: async () => undefined,
        now: () => NOW,
      });
      expect(evidence.sourceArtifacts.every((artifact) => artifact.match === "candidate")).toBe(true);
    }
  });

  it.each(["same_content", "same_domain"] as const)("requires independent press domain and content identity: %s", async (mode) => {
    const { ctx, evidence } = context();
    const sources = mode === "same_domain"
      ? [{ url: "https://techcrunch.com/fund-a" }, { url: "https://news.techcrunch.com/fund-b" }]
      : [{ url: "https://techcrunch.com/fund-a" }, { url: "https://reuters.com/fund-b" }];
    await collectFundScale(ctx, {
      discover: async () => [lead({ sources })],
      fetchSource: async (url) => document({
        url,
        host: new URL(url).hostname,
        contentHash: mode === "same_content" ? "a".repeat(64) : url.includes("news.") ? "b".repeat(64) : "a".repeat(64),
        text: url.includes("fund-a")
          ? "Paradigm announced Venture Fund III, a new $850 million venture fund."
          : "Paradigm completed its third venture fund at $850 million.",
      }),
      resolveInvestorDomain: async () => undefined,
      now: () => NOW,
    });
    expect(evidence.sourceArtifacts).toHaveLength(2);
    expect(evidence.sourceArtifacts.every((artifact) => artifact.match === "candidate")).toBe(true);
  });

  it("never lets different vehicles corroborate each other at the same amount", async () => {
    const { ctx, evidence } = context();
    const sources = [
      { url: "https://techcrunch.com/paradigm-fund-i" },
      { url: "https://reuters.com/technology/paradigm-fund-iii" },
    ];
    await collectFundScale(ctx, {
      discover: async () => [lead({ sources })],
      fetchSource: async (url) => document({
        url,
        host: new URL(url).hostname,
        contentHash: url.includes("reuters") ? "b".repeat(64) : "a".repeat(64),
        text: url.includes("reuters")
          ? "Paradigm Fund III closed at $400 million in 2024."
          : "Paradigm Fund I closed at $400 million in 2018.",
      }),
      resolveInvestorDomain: async () => undefined,
      now: () => NOW,
    });
    expect(evidence.sourceArtifacts).toHaveLength(2);
    expect(evidence.sourceArtifacts.every((artifact) => artifact.match === "candidate")).toBe(true);
    expect(new Set(evidence.sourceArtifacts.map((artifact) => artifact.fundVehicle))).toEqual(new Set(["Fund I", "Fund III"]));
    expect(new Set(evidence.sourceArtifacts.map((artifact) => artifact.fundScaleClaimId)).size).toBe(2);
  });

  it("keeps parallel strategy vehicles with the same number distinct", async () => {
    const { ctx, evidence } = context();
    const sources = [
      { url: "https://techcrunch.com/paradigm-growth-iii" },
      { url: "https://reuters.com/technology/paradigm-venture-iii" },
    ];
    await collectFundScale(ctx, {
      discover: async () => [lead({ sources })],
      fetchSource: async (url) => document({
        url,
        host: new URL(url).hostname,
        contentHash: url.includes("reuters") ? "b".repeat(64) : "a".repeat(64),
        text: url.includes("reuters")
          ? "Paradigm Venture Fund III closed at $400 million."
          : "Paradigm Growth Fund III closed at $400 million.",
      }),
      resolveInvestorDomain: async () => undefined,
      now: () => NOW,
    });
    expect(evidence.sourceArtifacts.every((artifact) => artifact.match === "candidate")).toBe(true);
    expect(new Set(evidence.sourceArtifacts.map((artifact) => artifact.fundVehicle))).toEqual(new Set([
      "Growth Fund III",
      "Venture Fund III",
    ]));
    expect(new Set(evidence.sourceArtifacts.map((artifact) => artifact.fundScaleClaimId)).size).toBe(2);
  });

  it("fails closed on conflicting current AUM records in the same reporting window", async () => {
    const { ctx, evidence } = context();
    const sources = [
      { url: SEC_RECORD_URL },
      { url: FCA_RECORD_URL },
    ];
    await collectFundScale(ctx, {
      discover: async () => [lead({ sources })],
      fetchSource: async (url) => document({
        url,
        host: new URL(url).hostname,
        contentHash: url.includes("sec.gov") ? "c".repeat(64) : "d".repeat(64),
        text: url.includes("sec.gov")
          ? "Paradigm manages $2.5 billion in assets under management as of January 1, 2026."
          : "Paradigm manages $3 billion in assets under management as of February 1, 2026.",
      }),
      resolveInvestorDomain: async () => undefined,
      now: () => NOW,
    });
    expect(evidence.sourceArtifacts).toHaveLength(2);
    expect(evidence.sourceArtifacts.every((artifact) => artifact.match === "candidate")).toBe(true);
  });

  it("clusters AUM values within ten percent into one deterministic claim", async () => {
    const { ctx, evidence } = context();
    const sources = [{ url: SEC_RECORD_URL }, { url: FCA_RECORD_URL }];
    const result = await collectFundScale(ctx, {
      discover: async () => [lead({ sources })],
      fetchSource: async (url) => document({
        url,
        host: new URL(url).hostname,
        contentHash: url.includes("sec.gov") ? "c".repeat(64) : "d".repeat(64),
        text: url.includes("sec.gov")
          ? "Paradigm manages $2.5 billion in assets under management as of January 1, 2026."
          : "Paradigm manages $2.65 billion in assets under management as of February 1, 2026.",
      }),
      resolveInvestorDomain: async () => undefined,
      now: () => NOW,
    });
    expect(result.state).toBe("executed");
    expect(evidence.sourceArtifacts).toHaveLength(2);
    expect(evidence.sourceArtifacts.every((artifact) => artifact.match === "fund_scale_confirmed")).toBe(true);
    expect(new Set(evidence.sourceArtifacts.map((artifact) => artifact.fundScaleClaimId)).size).toBe(1);
    expect(evidence.sourceArtifacts.every((artifact) => isStrictFundScaleArtifact(artifact, evidence.sourceArtifacts))).toBe(true);
  });

  it("does not let other_public AUM move the date window or veto first-party evidence", async () => {
    const { ctx, evidence } = context();
    const sources = [
      { url: "https://paradigm.xyz/aum" },
      { url: "https://attacker.example/aum" },
    ];
    const result = await collectFundScale(ctx, {
      discover: async () => [lead({ sources })],
      fetchSource: async (url) => document({
        url,
        host: new URL(url).hostname,
        contentHash: url.includes("paradigm.xyz") ? "e".repeat(64) : "f".repeat(64),
        text: url.includes("paradigm.xyz")
          ? "We manage $2 billion in assets under management as of January 1, 2026."
          : "Paradigm manages $3 billion in assets under management as of January 2, 2026.",
      }),
      now: () => NOW,
    });
    expect(result.state).toBe("executed");
    expect(evidence.sourceArtifacts).toContainEqual(expect.objectContaining({
      sourceClass: "first_party_subject",
      fundSizeUsd: 2_000_000_000,
      match: "fund_scale_confirmed",
    }));
    expect(evidence.sourceArtifacts).toContainEqual(expect.objectContaining({
      sourceClass: "other_public",
      fundSizeUsd: 3_000_000_000,
      match: "candidate",
    }));
  });

  it("does not let an uncorroborated press AUM claim veto first-party evidence", async () => {
    const { ctx, evidence } = context();
    const sources = [
      { url: "https://paradigm.xyz/aum" },
      { url: "https://techcrunch.com/paradigm-aum" },
    ];
    const result = await collectFundScale(ctx, {
      discover: async () => [lead({ sources })],
      fetchSource: async (url) => document({
        url,
        host: new URL(url).hostname,
        contentHash: url.includes("paradigm.xyz") ? "1".repeat(64) : "2".repeat(64),
        text: url.includes("paradigm.xyz")
          ? "We manage $2 billion in assets under management as of January 1, 2026."
          : "Paradigm manages $3 billion in assets under management as of January 2, 2026.",
      }),
      now: () => NOW,
    });
    expect(result.state).toBe("executed");
    expect(evidence.sourceArtifacts).toContainEqual(expect.objectContaining({
      sourceClass: "first_party_subject",
      fundSizeUsd: 2_000_000_000,
      match: "fund_scale_confirmed",
    }));
    expect(evidence.sourceArtifacts).toContainEqual(expect.objectContaining({
      sourceClass: "independent_press",
      fundSizeUsd: 3_000_000_000,
      match: "candidate",
    }));
  });

  it("reports partial coverage when one claim verifies but another cited source fails", async () => {
    const { ctx, evidence } = context();
    const result = await collectFundScale(ctx, {
      discover: async () => [
        lead(),
        lead({ fundVehicleHint: "Growth Fund", sources: [{ url: "https://paradigm.xyz/broken" }] }),
      ],
      fetchSource: async (url): Promise<PublicTextResult> => url.includes("broken")
        ? { status: "failed", reason: "http_403" }
        : document(),
      now: () => NOW,
    });
    expect(result.state).toBe("partial");
    expect(evidence.sourceArtifacts).toContainEqual(expect.objectContaining({ match: "fund_scale_confirmed" }));
  });
});
