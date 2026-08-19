import { describe, expect, it } from "vitest";
import type { CollectedEvidence, SubjectOrientation } from "../src/data/evidence";
import {
  buildOrientationPacket,
  orientationHandleBound,
  orientSubjectWithGrok,
  parseOrientation,
  type OrientationPacket,
} from "./subjectOrientation";

const MULTIHOPPER_BIO = "SWIFT 2.0 for digital assets. Programmable, non-custodial routing…";
const MULTIHOPPER_TITLE = "MultiHopper | Onchain Asset Routing Infrastructure (Non-Custodial)";

function packet(overrides: Partial<OrientationPacket> = {}): OrientationPacket {
  return {
    handle: "@multihopper",
    profileResolved: true,
    profileProvider: "twitterapi",
    bio: MULTIHOPPER_BIO,
    selfPostSample: "",
    recentActivity: [],
    websiteUrl: "https://multihopper.com/",
    websiteHost: "multihopper.com",
    websiteTitle: MULTIHOPPER_TITLE,
    siteExcerpt: `live site: "${MULTIHOPPER_TITLE}"`,
    sourceUrls: ["https://x.com/multihopper", "https://multihopper.com/"],
    ...overrides,
  };
}

function grokProject(overrides: Partial<SubjectOrientation> = {}): SubjectOrientation {
  return {
    kind: "PROJECT",
    what: "Non-custodial onchain asset routing infrastructure.",
    audience: "teams moving digital assets",
    boundHandle: "@multihopper",
    boundDomain: "multihopper.com",
    sourceUrls: ["https://x.com/multihopper", "https://multihopper.com/"],
    ...overrides,
  };
}

function stubEvidence(): CollectedEvidence {
  return {
    profile: {
      handle: "@multihopper",
      display_name: "MultiHopper",
      bio: MULTIHOPPER_BIO,
      website: "https://multihopper.com",
      followers: "N/A",
      joined: "N/A",
      identity_confidence: "Unverified",
      identity_note: "No identity resolution available.",
      profile_collection_state: "resolved",
      profile_provider: "twitterapi",
      profile_captured_at: "2026-08-19T12:00:00.000Z",
      avatar: "M",
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
    headline: "",
    recentActivity: ["Routing is live on mainnet."],
    notableFollowers: [],
    contradictions: [],
    sourceArtifacts: [],
  } as CollectedEvidence;
}

describe("buildOrientationPacket", () => {
  it("collects bound handle, bio, and official domain and never uses display name as a key", () => {
    const built = buildOrientationPacket(stubEvidence(), `live site: "${MULTIHOPPER_TITLE}"`);
    expect(built.handle).toBe("@multihopper");
    expect(built.bio).toBe(MULTIHOPPER_BIO);
    expect(built.websiteHost).toBe("multihopper.com");
    expect(built.websiteUrl).toBe("https://multihopper.com/");
    expect(built.websiteTitle).toBe(MULTIHOPPER_TITLE);
    expect(built.sourceUrls).toEqual(["https://x.com/multihopper", "https://multihopper.com/"]);
    expect(JSON.stringify(built)).not.toContain("display_name");
    expect(Object.keys(built)).not.toContain("displayName");
    expect(Object.keys(built)).not.toContain("display_name");
  });
});

describe("parseOrientation bind rules", () => {
  it("accepts a Multihopper PROJECT when handle and official domain bind", () => {
    const parsed = parseOrientation(grokProject(), packet());
    expect(parsed).toEqual(expect.objectContaining({
      kind: "PROJECT",
      boundHandle: "@multihopper",
      boundDomain: "multihopper.com",
      what: "Non-custodial onchain asset routing infrastructure.",
    }));
  });

  it("drops a hallucinated domain to UNKNOWN", () => {
    const parsed = parseOrientation(grokProject({ boundDomain: "uniswap.org" }), packet());
    expect(parsed).toEqual(expect.objectContaining({
      kind: "UNKNOWN",
      boundHandle: "@multihopper",
      boundDomain: null,
    }));
  });

  it("rejects a display-name-only bind", () => {
    // Display name is never a bind key, even when it spells the same as the
    // handle. Without a twitterapi-resolved handle the kind cannot stick.
    const parsed = parseOrientation(grokProject({
      kind: "FOUNDER",
      boundHandle: "MultiHopper",
      boundDomain: null,
    }), packet({ profileResolved: false, profileProvider: null }));
    expect(parsed?.kind).toBe("UNKNOWN");
    expect(parsed?.boundDomain).toBeNull();
  });

  it("rejects FOUNDER when the handle is not twitterapi-resolved", () => {
    const parsed = parseOrientation(
      { kind: "FOUNDER", what: "A person.", audience: "", boundHandle: "@multihopper", boundDomain: null, sourceUrls: [] },
      packet({ profileResolved: false, profileProvider: null }),
    );
    expect(parsed?.kind).toBe("UNKNOWN");
  });

  it("rejects PROJECT when boundDomain is missing", () => {
    const parsed = parseOrientation(grokProject({ boundDomain: null }), packet());
    expect(parsed?.kind).toBe("UNKNOWN");
  });

  it("accepts FOUNDER from a twitterapi handle without a domain", () => {
    const parsed = parseOrientation({
      kind: "FOUNDER",
      what: "A builder named on the bound account.",
      audience: "",
      boundHandle: "@multihopper",
      boundDomain: null,
      sourceUrls: ["https://x.com/multihopper"],
    }, packet());
    expect(parsed).toEqual(expect.objectContaining({
      kind: "FOUNDER",
      boundHandle: "@multihopper",
      boundDomain: null,
    }));
  });
});

describe("orientSubjectWithGrok", () => {
  it("parses a mocked Grok PROJECT reply against the Multihopper packet", async () => {
    const evidence = stubEvidence();
    const oriented = await orientSubjectWithGrok(evidence, {
      siteExcerpt: `live site: "${MULTIHOPPER_TITLE}"`,
      chat: async () => ({
        ok: true,
        status: 200,
        data: {},
        text: JSON.stringify(grokProject()),
      }),
    });
    expect(oriented).toEqual(expect.objectContaining({
      kind: "PROJECT",
      boundHandle: "@multihopper",
      boundDomain: "multihopper.com",
    }));
  });

  it("returns null when the mocked LLM call fails", async () => {
    const oriented = await orientSubjectWithGrok(stubEvidence(), {
      chat: async () => ({ ok: false, status: 503 }),
    });
    expect(oriented).toBeNull();
  });

  it("returns null when no XAI key is configured and fallbacks are off", async () => {
    const prevKey = process.env.XAI_API_KEY;
    const prevFallback = process.env.ARGUS_PROVIDER_FALLBACKS;
    delete process.env.XAI_API_KEY;
    delete process.env.ARGUS_PROVIDER_FALLBACKS;
    try {
      await expect(orientSubjectWithGrok(stubEvidence())).resolves.toBeNull();
    } finally {
      if (prevKey === undefined) delete process.env.XAI_API_KEY;
      else process.env.XAI_API_KEY = prevKey;
      if (prevFallback === undefined) delete process.env.ARGUS_PROVIDER_FALLBACKS;
      else process.env.ARGUS_PROVIDER_FALLBACKS = prevFallback;
    }
  });
});

describe("orientationHandleBound", () => {
  it("binds the Multihopper twitterapi handle for routing", () => {
    const evidence = stubEvidence();
    evidence.subjectOrientation = grokProject();
    expect(orientationHandleBound(evidence)).toBe(true);
  });
});
