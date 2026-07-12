import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyEvidence } from "../../src/data/evidence";
import { SubjectClass } from "../../src/engine";
import { isStrictFundScaleArtifact } from "../../src/lib/fundScaleEvidence";
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
import { discoverPortfolioCandidates } from "./portfolio";

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

  it("shares one bounded Grok search with portfolio discovery", async () => {
    vi.stubEnv("XAI_API_KEY", "xai-test-key");
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output_text: JSON.stringify({
        investments: [{ project: "Acme", sources: [{ url: "https://paradigm.xyz/portfolio/acme" }] }],
        fund_scale: [{ fund_name: "Paradigm", sources: [{ url: "https://paradigm.xyz/fund" }] }],
      }),
      output: [{ type: "web_search_call" }],
      usage: { input_tokens: 10, output_tokens: 10 },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { ctx } = context();

    await expect(discoverPortfolioCandidates(ctx)).resolves.toHaveLength(1);
    await expect(discoverFundScaleCandidates(ctx)).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
