import { describe, expect, it } from "vitest";
import {
  canonicalOfficialWebsite,
  canonicalPublicProfileWebsite,
  isStrictFundScaleArtifact,
} from "./fundScaleEvidence";

const base = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  kind: "fund_scale",
  provider: "fund-scale-web",
  title: "Subject Venture Fund I closed at $500 million",
  excerpt: "Subject closed Subject Venture Fund I at $500 million.",
  sourceUrl: "https://subject.example/funds/venture-i",
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
  fundScaleClaimId: "fund_scale_claim_v1_subject_venture_i",
  ...overrides,
});

const press = (overrides: Record<string, unknown> = {}): Record<string, unknown> => base({
  sourceUrl: "https://reuters.com/markets/subject-fund-i",
  sourceContentHash: "c".repeat(64),
  excerpt: "Subject Venture Fund I completed a $500 million close, Reuters reported.",
  sourceClass: "independent_press",
  fundScaleBasis: "press_corroborated",
  fundScaleSourceCount: 2,
  ...overrides,
});

describe("isStrictFundScaleArtifact", () => {
  it("sanitizes public profile URLs and only promotes dedicated official domains", () => {
    expect(canonicalPublicProfileWebsite("https://subject.example/about?utm_source=x#team")).toBe("https://subject.example/about");
    expect(canonicalPublicProfileWebsite("https://subject.example/private?token=secret")).toBeNull();
    expect(canonicalOfficialWebsite("https://subject.example/about")).toEqual({
      domain: "subject.example",
      canonicalUrl: "https://subject.example/about",
    });
    expect(canonicalOfficialWebsite("https://mirror.xyz/subject.eth")).toBeNull();
    expect(canonicalOfficialWebsite("https://ipfs.io/ipfs/bafy-profile")).toBeNull();
    expect(canonicalOfficialWebsite("https://co.uk")).toBeNull();
  });
  it("accepts a content-addressed, entity-bound first-party vehicle claim", () => {
    expect(isStrictFundScaleArtifact(base())).toBe(true);
    expect(isStrictFundScaleArtifact(base({ subjectName: "NotSubjectScam" }))).toBe(false);
    expect(isStrictFundScaleArtifact(base({ subjectHandle: "@attacker" }), [], { subjectHandle: "@victim" })).toBe(false);
    const profile = {
      handle: "@subject",
      display_name: "Subject",
      bio: "Investment manager",
      website: "https://subject.example",
      profile_collection_state: "resolved",
      profile_provider: "twitterapi",
      profile_captured_at: "2026-07-11T11:59:00.000Z",
    };
    expect(isStrictFundScaleArtifact(base(), [], { subjectHandle: "@subject", profile })).toBe(true);
    expect(isStrictFundScaleArtifact(base({
      sourceUrl: "https://attacker.com/fund",
      investorEntityDomain: "attacker.com",
    }), [], { subjectHandle: "@subject", profile })).toBe(false);
  });

  it.each([
    ["claim id", { fundScaleClaimId: undefined }],
    ["vehicle", { fundVehicle: undefined }],
    ["source hash", { sourceContentHash: undefined }],
    ["entity binding", { investorEntityName: "Another Manager" }],
    ["sensitive URL", { sourceUrl: "https://subject.example/fund?token=secret" }],
  ])("rejects a first-party claim without valid %s", (_label, overrides) => {
    expect(isStrictFundScaleArtifact(base(overrides))).toBe(false);
  });

  it("rejects multi-tenant profile hosts as first-party publications", () => {
    expect(isStrictFundScaleArtifact(base({
      sourceUrl: "https://linktr.ee/attacker/fund",
      investorEntityDomain: "linktr.ee",
    }))).toBe(false);
    expect(isStrictFundScaleArtifact(base({
      sourceUrl: "https://github.com/attacker/fake",
      investorEntityDomain: "github.com",
    }))).toBe(false);
  });

  it("requires current, exact provider-profile proof for an affiliated fund", () => {
    const affiliated = base({
      subjectName: "Alice Investor",
      subjectHandle: "@alice",
      investorEntityName: "Subject Capital",
      fundName: "Subject Capital",
      sourceUrl: "https://www.sec.gov/Archives/edgar/data/123456/000012345626000001/adv.html",
      attribution: "affiliated_fund",
      sourceClass: "public_primary",
      fundScaleMetric: "regulatory_aum",
      fundScaleBasis: "regulatory",
      fundScaleTemporalState: "current",
      fundScaleAsOf: "2026-06-30T00:00:00.000Z",
      fundVehicle: undefined,
      attributionSourceUrl: "https://x.com/alice",
      attributionSourceContentHash: "d".repeat(64),
      attributionCapturedAt: "2026-07-11T11:58:00.000Z",
      attributionSourceKind: "provider_profile",
    });
    expect(isStrictFundScaleArtifact(affiliated)).toBe(true);
    const profile = {
      handle: "@alice",
      display_name: "Alice Investor",
      bio: "Independent researcher; no fund role",
      profile_collection_state: "resolved",
      profile_provider: "twitterapi",
      profile_captured_at: "2026-07-11T11:58:00.000Z",
    };
    expect(isStrictFundScaleArtifact(affiliated, [], { subjectHandle: "@alice", profile })).toBe(false);
    expect(isStrictFundScaleArtifact(affiliated, [], {
      subjectHandle: "@alice",
      profile: { ...profile, bio: "Research Partner at Subject Capital" },
    })).toBe(true);
    expect(isStrictFundScaleArtifact(affiliated, [], {
      subjectHandle: "@alice",
      profile: { ...profile, bio: "GP @Subject Capital" },
    })).toBe(true);
    expect(isStrictFundScaleArtifact(affiliated, [], {
      subjectHandle: "@alice",
      profile: { ...profile, bio: "Research @Subject Capital" },
    })).toBe(true);
    expect(isStrictFundScaleArtifact(affiliated, [], {
      subjectHandle: "@alice",
      profile: { ...profile, bio: "Co-founder @Subject Capital" },
    })).toBe(true);
    expect(isStrictFundScaleArtifact(affiliated, [], {
      subjectHandle: "@alice",
      profile: { ...profile, bio: "Portfolio manager @Subject Capital" },
    })).toBe(true);
    expect(isStrictFundScaleArtifact(affiliated, [], {
      subjectHandle: "@alice",
      profile: { ...profile, bio: "Currently independent, formerly Research Partner at Subject Capital" },
    })).toBe(false);
    expect(isStrictFundScaleArtifact(affiliated, [], {
      subjectHandle: "@alice",
      profile: { ...profile, bio: "Not @Subject Capital partner" },
    })).toBe(false);
    expect(isStrictFundScaleArtifact(affiliated, [], {
      subjectHandle: "@alice",
      profile: { ...profile, bio: "Currently independent and formerly Research Partner at Subject Capital" },
    })).toBe(false);
    expect(isStrictFundScaleArtifact(affiliated, [], {
      subjectHandle: "@alice",
      profile: { ...profile, bio: "Former Research Partner at Subject Capital and currently independent" },
    })).toBe(false);
    expect(isStrictFundScaleArtifact(affiliated, [], {
      subjectHandle: "@alice",
      profile: { ...profile, bio: "Research Partner at Subject Capital; left in 2024" },
    })).toBe(false);
    expect(isStrictFundScaleArtifact(affiliated, [], {
      subjectHandle: "@alice",
      profile: { ...profile, bio: "Research Partner at Subject Capital, no longer there" },
    })).toBe(false);
    expect(isStrictFundScaleArtifact(affiliated, [], {
      subjectHandle: "@alice",
      profile: { ...profile, bio: "Previously at Sequoia, now Research Partner at Subject Capital" },
    })).toBe(true);
    expect(isStrictFundScaleArtifact(affiliated, [], {
      subjectHandle: "@alice",
      profile: { ...profile, bio: "Previously at Sequoia and now Research Partner at Subject Capital" },
    })).toBe(true);
    expect(isStrictFundScaleArtifact(affiliated, [], {
      subjectHandle: "@alice",
      profile: { ...profile, bio: "Currently Research Partner at Subject Capital after previously being independent" },
    })).toBe(true);
    expect(isStrictFundScaleArtifact({ ...affiliated, subjectName: undefined })).toBe(false);
    expect(isStrictFundScaleArtifact({ ...affiliated, attributionSourceUrl: "https://x.com/unrelated" })).toBe(false);
    expect(isStrictFundScaleArtifact({ ...affiliated, attributionSourceContentHash: undefined })).toBe(false);
    expect(isStrictFundScaleArtifact({
      ...affiliated,
      attributionSourceKind: "verified_venture",
      attributionSourceUrl: "https://employment.example/people/alice",
    })).toBe(false);
    expect(isStrictFundScaleArtifact({
      ...affiliated,
      attributionSourceKind: "verified_venture",
      attributionSourceUrl: "https://employment.example/people/unrelated",
    })).toBe(false);
    expect(isStrictFundScaleArtifact({
      ...affiliated,
      attributionSourceKind: "verified_venture",
      attributionSourceUrl: "https://employment.example/people/malice-record",
    })).toBe(false);
  });

  it("accepts an affiliated manager page only with a frozen exact fund-domain profile proof", () => {
    const affiliatedPage = base({
      subjectName: "Alice Investor",
      subjectHandle: "@alice",
      investorEntityName: "Subject Capital",
      investorEntityHandle: "@subjectcapital",
      investorEntityDomain: "subjectcapital.example",
      fundName: "Subject Capital",
      sourceUrl: "https://subjectcapital.example/funds/venture-i",
      attribution: "affiliated_fund",
      sourceClass: "first_party_investor",
      attributionSourceUrl: "https://x.com/alice",
      attributionSourceContentHash: "d".repeat(64),
      attributionCapturedAt: "2026-07-11T11:58:00.000Z",
      attributionSourceKind: "provider_profile",
      investorDomainSourceUrl: "https://x.com/subjectcapital",
      investorDomainSourceContentHash: "e".repeat(64),
      investorDomainCapturedAt: "2026-07-11T11:59:00.000Z",
      investorDomainSourceKind: "provider_profile",
      investorDomainProfileName: "Subject Capital",
      investorDomainProfileWebsite: "https://subjectcapital.example",
    });
    const profile = {
      handle: "@alice",
      display_name: "Alice Investor",
      bio: "Research Partner @subjectcapital",
      profile_collection_state: "resolved",
      profile_provider: "twitterapi",
      profile_captured_at: "2026-07-11T11:58:00.000Z",
    };
    const context = { subjectHandle: "@alice", profile };

    expect(isStrictFundScaleArtifact(affiliatedPage, [], context)).toBe(true);
    expect(isStrictFundScaleArtifact(affiliatedPage, [], {
      subjectHandle: "@alice",
      profile: { ...profile, bio: "Co-founder @subjectcapital" },
    })).toBe(true);
    expect(isStrictFundScaleArtifact({
      ...affiliatedPage,
      sourceUrl: "https://subjectcapital.example/about/funds/venture-i",
      investorDomainProfileWebsite: "https://subjectcapital.example/about",
    }, [], context)).toBe(true);
    expect(isStrictFundScaleArtifact({
      ...affiliatedPage,
      sourceUrl: "https://dev.to/attacker/fake-fund-123",
      investorEntityDomain: "dev.to",
      investorDomainProfileWebsite: "https://dev.to/paradigm",
    }, [], context)).toBe(false);
    expect(isStrictFundScaleArtifact(affiliatedPage, [], {
      subjectHandle: "@alice",
      profile: { ...profile, bio: "Research Partner at Subject Capital" },
    })).toBe(false);
    expect(isStrictFundScaleArtifact({ ...affiliatedPage, investorDomainProfileName: "Subject Capital Ventures" }, [], context)).toBe(true);
    expect(isStrictFundScaleArtifact({ ...affiliatedPage, investorDomainSourceUrl: "https://x.com/attacker" }, [], context)).toBe(false);
    expect(isStrictFundScaleArtifact({ ...affiliatedPage, investorDomainSourceContentHash: undefined }, [], context)).toBe(false);
    expect(isStrictFundScaleArtifact({ ...affiliatedPage, investorDomainProfileName: "Attacker Capital" }, [], context)).toBe(false);
    expect(isStrictFundScaleArtifact({ ...affiliatedPage, investorDomainProfileWebsite: "https://attacker.example" }, [], context)).toBe(false);
    expect(isStrictFundScaleArtifact({ ...affiliatedPage, investorDomainProfileWebsite: "https://subjectcapital.example/?token=secret" }, [], context)).toBe(false);
    expect(isStrictFundScaleArtifact({ ...affiliatedPage, investorDomainSourceKind: undefined }, [], context)).toBe(false);
    expect(isStrictFundScaleArtifact(affiliatedPage, [], {
      subjectHandle: "@alice",
      profile: { ...profile, bio: "Not a partner @subjectcapital" },
    })).toBe(false);
    expect(isStrictFundScaleArtifact(affiliatedPage, [], {
      subjectHandle: "@alice",
      profile: { ...profile, bio: "Former co-founder @subjectcapital" },
    })).toBe(false);
    expect(isStrictFundScaleArtifact(affiliatedPage, [], {
      subjectHandle: "@alice",
      profile: { ...profile, bio: "Not @subjectcapital partner" },
    })).toBe(false);
    expect(isStrictFundScaleArtifact(affiliatedPage, [], {
      subjectHandle: "@alice",
      profile: { ...profile, bio: "Never @subjectcapital employee" },
    })).toBe(false);
  });

  it("accepts only record-specific regulatory AUM pages", () => {
    const regulatory = base({
      sourceUrl: "https://www.sec.gov/Archives/edgar/data/123456/000012345626000001/adv.html",
      sourceClass: "public_primary",
      fundScaleMetric: "regulatory_aum",
      fundScaleBasis: "regulatory",
      fundScaleTemporalState: "current",
      fundScaleAsOf: "2026-06-30T00:00:00.000Z",
      fundVehicle: undefined,
    });
    expect(isStrictFundScaleArtifact(regulatory)).toBe(true);
    expect(isStrictFundScaleArtifact({ ...regulatory, sourceUrl: "https://www.sec.gov/newsroom" })).toBe(false);
    expect(isStrictFundScaleArtifact({ ...regulatory, sourceUrl: "https://www.sec.gov/Archives/edgar/data/123456/" })).toBe(false);
    expect(isStrictFundScaleArtifact({ ...regulatory, sourceUrl: "https://www.sec.gov/Archives/edgar/data/123456/1234567890/not-a-real-record.html" })).toBe(false);
    expect(isStrictFundScaleArtifact({ ...regulatory, sourceUrl: "http://www.sec.gov/Archives/edgar/data/123456/000012345626000001/adv.html" })).toBe(false);
  });

  it("requires two frozen, compatible press artifacts instead of trusting sourceCount", () => {
    const first = press();
    const second = press({
      sourceUrl: "https://ft.com/content/subject-fund-i",
      sourceContentHash: "d".repeat(64),
      contentHash: "e".repeat(64),
      excerpt: "The Financial Times says Subject closed its first venture vehicle with $500 million.",
    });
    expect(isStrictFundScaleArtifact(first, [first])).toBe(false);
    expect(isStrictFundScaleArtifact(first, [first, second])).toBe(true);
    expect(isStrictFundScaleArtifact(first, [first, { ...second, sourceUrl: "https://markets.reuters.com/subject" }])).toBe(false);
    expect(isStrictFundScaleArtifact(first, [first, { ...second, sourceContentHash: first.sourceContentHash }])).toBe(false);
    expect(isStrictFundScaleArtifact(first, [first, { ...second, fundVehicle: "Subject Venture Fund III" }])).toBe(false);
  });

  it("rejects shared-host press, public-suffix official domains, local hosts, and future captures", () => {
    const sharedPress = press({ sourceUrl: "https://medium.com/subject/fund-i" });
    const otherShared = press({
      sourceUrl: "https://subject.substack.com/p/fund-i",
      sourceContentHash: "d".repeat(64),
      contentHash: "e".repeat(64),
      excerpt: "A separate newsletter repeats the completed $500 million close for Subject Venture Fund I.",
    });
    expect(isStrictFundScaleArtifact(sharedPress, [sharedPress, otherShared])).toBe(false);
    expect(isStrictFundScaleArtifact(base({ investorEntityDomain: "com", sourceUrl: "https://attacker.com/fund" }))).toBe(false);
    expect(isStrictFundScaleArtifact(base({ investorEntityDomain: "co.za", sourceUrl: "https://attacker.co.za/fund" }))).toBe(false);
    expect(isStrictFundScaleArtifact(base({ investorEntityDomain: "reuters.com", sourceUrl: "https://reuters.com/fund" }))).toBe(false);
    expect(isStrictFundScaleArtifact(base({ investorEntityDomain: "127.0.0.1", sourceUrl: "https://127.0.0.1/fund" }))).toBe(false);
    expect(isStrictFundScaleArtifact(base({ capturedAt: "2099-07-11T12:00:00.000Z" }))).toBe(false);
    expect(isStrictFundScaleArtifact(base({ capturedAt: "2026-07-12T00:06:00.000Z" }), [], {
      now: new Date("2026-07-12T00:00:00.000Z"),
    })).toBe(false);
  });
});
