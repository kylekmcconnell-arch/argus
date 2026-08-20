import { afterEach, describe, expect, it, vi } from "vitest";
import type { CollectedEvidence, SubjectOrientation } from "../src/data/evidence";
import {
  buildOrientationPacket,
  firstPartyTokenTickers,
  orientationHandleBound,
  orientationMentionLeads,
  orientSubjectWithGrok,
  parseOrientation,
  type OrientationPacket,
} from "./subjectOrientation";

const MULTIHOPPER_BIO = "SWIFT 2.0 for digital assets. Programmable, non-custodial routing…";
const MULTIHOPPER_TITLE = "MultiHopper | Onchain Asset Routing Infrastructure (Non-Custodial)";

function packet(overrides: Partial<OrientationPacket> = {}): OrientationPacket {
  return {
    handle: "@multihopper",
    profileName: "MultiHopper",
    profileResolved: true,
    profileProvider: "twitterapi",
    followers: "1840",
    createdAt: "2025-11-02T00:00:00.000Z",
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
      followers: "1,840",
      joined: "Nov 2025",
      account_created_at: "2025-11-02T00:00:00.000Z",
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

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

describe("buildOrientationPacket", () => {
  it("collects bound handle, bio, and official domain and never uses display name as a key", () => {
    const built = buildOrientationPacket(stubEvidence(), `live site: "${MULTIHOPPER_TITLE}"`);
    expect(built.handle).toBe("@multihopper");
    expect(built.bio).toBe(MULTIHOPPER_BIO);
    expect(built.websiteHost).toBe("multihopper.com");
    expect(built.websiteUrl).toBe("https://multihopper.com/");
    expect(built.websiteTitle).toBe(MULTIHOPPER_TITLE);
    expect(built.sourceUrls).toEqual(["https://x.com/multihopper", "https://multihopper.com/"]);
    expect(built.profileName).toBe("MultiHopper");
    expect(built.followers).toBe("1,840");
    expect(built.createdAt).toBe("2025-11-02T00:00:00.000Z");
    expect(JSON.stringify(built)).not.toContain("display_name");
    expect(Object.keys(built)).not.toContain("displayName");
    expect(Object.keys(built)).not.toContain("display_name");
  });

  it("keeps a richer first-party X sample than the old 12x280 packet", () => {
    const evidence = stubEvidence();
    evidence.recentActivity = Array.from({ length: 30 }, (_, i) => `post-${i} ${"x".repeat(600)}`);
    evidence.profile.self_post_sample = `own ${"y".repeat(7000)}`;
    const built = buildOrientationPacket(evidence);
    expect(built.recentActivity).toHaveLength(24);
    expect(built.recentActivity.every((item) => item.length === 500)).toBe(true);
    expect(built.selfPostSample.length).toBe(6000);
  });
});

describe("parseOrientation bind rules", () => {
  it("keeps a first-party ticker candidate when Grok omits it from launched products", () => {
    const clutchPacket = packet({
      handle: "@ClutchMarkets",
      profileName: "CLUTCH",
      bio: "Building prediction markets and $STONKBROKER.",
      selfPostSample: "We launched $STONKBROKER on Robinhood Chain.",
      recentActivity: ["$STONKBROKER is now live."],
      websiteUrl: "https://clutch.markets/",
      websiteHost: "clutch.markets",
      websiteTitle: "Clutch Markets",
      siteExcerpt: "Clutch Markets",
      sourceUrls: ["https://x.com/ClutchMarkets", "https://clutch.markets/"],
    });

    expect(firstPartyTokenTickers(clutchPacket)).toEqual(["STONKBROKER"]);
    const parsed = parseOrientation({
      ...grokProject({
        boundHandle: "@ClutchMarkets",
        boundDomain: "clutch.markets",
        launchedProducts: [{ name: "Stonk Exchange", domain: "stonkbrokers.io" }],
      }),
    }, clutchPacket);

    expect(parsed?.launchedProducts).toEqual([
      { tokenTicker: "STONKBROKER" },
      { name: "Stonk Exchange", domain: "stonkbrokers.io" },
    ]);
  });

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

  it("keeps quoted @handles from live X and drops invented ones without a quote", () => {
    const parsed = parseOrientation({
      ...grokProject(),
      mentionedHandles: [
        { handle: "@alice", roleHint: "co-founder", quote: "Welcome co-founder @alice to the team." },
        { handle: "@bob" },
        { handle: "Carol", quote: "Carol is our CEO" },
        { handle: "@dave", quote: "a teammate joined today" },
      ],
    }, packet());
    expect(parsed?.kind).toBe("PROJECT");
    expect(parsed?.mentionedHandles).toEqual([
      { handle: "@alice", roleHint: "co-founder", quote: "Welcome co-founder @alice to the team." },
    ]);
  });

  it("drops a relatedFounderHandle that equals the subject handle", () => {
    const parsed = parseOrientation({
      ...grokProject(),
      relatedFounderHandle: "@multihopper",
      relatedCompanyHandle: "@multihopper",
    }, packet());
    expect(parsed?.kind).toBe("PROJECT");
    expect(parsed?.relatedFounderHandle).toBeUndefined();
    expect(parsed?.relatedCompanyHandle).toBeUndefined();
  });

  it("does not let a launched product domain overwrite subject boundDomain", () => {
    const parsed = parseOrientation({
      ...grokProject(),
      launchedProducts: [
        { name: "Launched Product", handle: "@launchedproduct", domain: "launched-product.example" },
      ],
    }, packet());
    expect(parsed?.kind).toBe("PROJECT");
    expect(parsed?.boundDomain).toBe("multihopper.com");
    expect(parsed?.launchedProducts).toEqual([
      { name: "Launched Product", handle: "@launchedproduct", domain: "launched-product.example" },
    ]);
  });

  it("drops an invented domain on a related product without UNKNOWNing the subject", () => {
    const parsed = parseOrientation({
      ...grokProject(),
      launchedProducts: [{ domain: "uniswap.org" }],
    }, packet());
    expect(parsed?.kind).toBe("PROJECT");
    expect(parsed?.boundHandle).toBe("@multihopper");
    expect(parsed?.boundDomain).toBe("multihopper.com");
    expect(parsed?.launchedProducts).toBeUndefined();
  });
});

describe("orientationMentionLeads", () => {
  it("turns quoted mentions into reverse-role-shaped leads without auto-binding", () => {
    const leads = orientationMentionLeads(grokProject({
      mentionedHandles: [
        { handle: "@alice", roleHint: "co-founder", quote: "Welcome co-founder @alice to the team." },
      ],
    }));
    expect(leads).toEqual([{
      name: "@alice",
      handle: "@alice",
      role: "co-founder",
      kind: "team",
      evidence: "Welcome co-founder @alice to the team.",
      source: "orientation-live-x",
      sourceUrl: "https://x.com/alice",
    }]);
  });

  it("exposes a related founder handle as a confirm-later team lead", () => {
    const leads = orientationMentionLeads(grokProject({
      relatedFounderHandle: "@alice",
    }));
    expect(leads).toEqual([{
      name: "@alice",
      handle: "@alice",
      role: "founder",
      kind: "team",
      evidence: "named as founder of this subject on official X or site",
      source: "orientation-live-x",
      sourceUrl: "https://x.com/alice",
    }]);
  });
});

describe("orientSubjectWithGrok", () => {
  it("bypasses the orientation cache for an explicit rescan", async () => {
    vi.stubEnv("XAI_API_KEY", "xai-test-key");
    const search = vi.fn(async () => JSON.stringify(grokProject()));

    await orientSubjectWithGrok(stubEvidence(), { search, bypassCache: true });

    expect(search).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        cacheKey: "subject-orientation:multihopper",
        bypassCache: true,
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

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

  it("parses a mocked Grok PROJECT graph with a different founder and launched product", async () => {
    const evidence = stubEvidence();
    const oriented = await orientSubjectWithGrok(evidence, {
      siteExcerpt: `live site: "${MULTIHOPPER_TITLE}"`,
      chat: async () => ({
        ok: true,
        status: 200,
        data: {},
        text: JSON.stringify({
          ...grokProject(),
          relatedFounderHandle: "@alice",
          launchedProducts: [
            { name: "Launched Product", handle: "@launchedproduct", domain: "launched-product.example" },
          ],
        }),
      }),
    });
    expect(oriented).toEqual(expect.objectContaining({
      kind: "PROJECT",
      boundHandle: "@multihopper",
      boundDomain: "multihopper.com",
      relatedFounderHandle: "@alice",
      launchedProducts: [
        { name: "Launched Product", handle: "@launchedproduct", domain: "launched-product.example" },
      ],
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

  it("reads live x_search of this handle and keeps only quoted mentions", async () => {
    vi.stubEnv("XAI_API_KEY", "xai-test-key");
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
    vi.stubEnv("ARGUS_PROVIDER_FALLBACKS", "on");
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("api.anthropic.com")) throw new Error("Claude must not run orientation");
      if (url.includes("api.x.ai/v1/chat/completions")) throw new Error("orientation must not use tool-less grokChat");
      expect(url).toBe("https://api.x.ai/v1/responses");
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        tools?: Array<{ type?: string }>;
        max_tool_calls?: number;
        input?: Array<{ content?: string }>;
      };
      expect(body.tools).toEqual([{ type: "web_search" }, { type: "x_search" }]);
      expect(body.max_tool_calls).toBe(3);
      expect(JSON.stringify(body.input)).toContain("x_search that exact handle only");
      expect(JSON.stringify(body.input)).not.toContain("You may only use the packet");
      return json({
        output_text: JSON.stringify({
          ...grokProject(),
          mentionedHandles: [
            { handle: "@alice", roleHint: "co-founder", quote: "Welcome co-founder @alice to the team." },
            { handle: "@bob" },
          ],
        }),
        output: [{ type: "x_search_call" }],
        usage: { input_tokens: 20, output_tokens: 40, num_sources_used: 2 },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const oriented = await orientSubjectWithGrok(stubEvidence(), {
      siteExcerpt: `live site: "${MULTIHOPPER_TITLE}"`,
    });

    expect(oriented).toEqual(expect.objectContaining({
      kind: "PROJECT",
      boundHandle: "@multihopper",
      boundDomain: "multihopper.com",
      mentionedHandles: [
        { handle: "@alice", roleHint: "co-founder", quote: "Welcome co-founder @alice to the team." },
      ],
    }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("api.anthropic.com"))).toBe(false);
  });

  it("still drops a hallucinated domain from the live-X path", async () => {
    vi.stubEnv("XAI_API_KEY", "xai-test-key");
    vi.stubGlobal("fetch", vi.fn(async () => json({
      output_text: JSON.stringify(grokProject({ boundDomain: "uniswap.org" })),
      output: [{ type: "x_search_call" }],
      usage: { input_tokens: 8, output_tokens: 8 },
    })));
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const oriented = await orientSubjectWithGrok(stubEvidence());
    expect(oriented).toEqual(expect.objectContaining({
      kind: "UNKNOWN",
      boundHandle: "@multihopper",
      boundDomain: null,
    }));
  });
});

describe("orientationHandleBound", () => {
  it("binds the Multihopper twitterapi handle for routing", () => {
    const evidence = stubEvidence();
    evidence.subjectOrientation = grokProject();
    expect(orientationHandleBound(evidence)).toBe(true);
  });
});
