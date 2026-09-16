import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cacheGet, cacheSet } = vi.hoisted(() => ({ cacheGet: vi.fn(), cacheSet: vi.fn() }));
vi.mock("./cache", () => ({ cacheGet, cacheSet }));

import { normalizeAuditHandle } from "./orchestrate";
import { enrichTeamIdentities, findTeamOnSite, getProfile } from "./adapters/x";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("one normalized handle for the whole run (OR-5)", () => {
  it("lowercases and strips the @ so embedded and direct audits share cache keys", () => {
    expect(normalizeAuditHandle("@Uniswap")).toBe("uniswap");
    expect(normalizeAuditHandle("  UNISWAP ")).toBe("uniswap");
    expect(normalizeAuditHandle("uniswap")).toBe("uniswap");
  });

  it("leaves non-handle input (a URL, a fixture path) untouched", () => {
    expect(normalizeAuditHandle("https://x.com/Uniswap")).toBe("https://x.com/Uniswap");
  });
});

describe("intake search caches are keyed by the audited handle, never the display name alone (OR-10)", () => {
  beforeEach(() => {
    cacheGet.mockReset();
    cacheSet.mockReset();
    cacheGet.mockResolvedValue(null);
    vi.stubEnv("XAI_API_KEY", "xai-test-key");
    vi.stubEnv("ARGUS_GENERAL_WEB_PROVIDER", "grok");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn(async () => json({ output_text: '{"people":[]}', output: [], usage: { input_tokens: 1, output_tokens: 1 } })));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("separates a KOL and the protocol that share the display name Kamino", async () => {
    await findTeamOnSite("https://kamino.finance", "Kamino", "@KaminoFinance");
    await findTeamOnSite("https://kamino.finance", "Kamino", "@KaminoCrypto");
    const keys = cacheGet.mock.calls.map(([key]) => String(key));
    expect(keys.some((key) => key.includes("kaminofinance"))).toBe(true);
    expect(keys.some((key) => key.includes("kaminocrypto"))).toBe(true);
    expect(new Set(keys).size).toBe(2);
  });

  it("keys identity enrichment by handle too", async () => {
    await enrichTeamIdentities("Kamino", [{ name: "Marius" }], "@KaminoFinance");
    await enrichTeamIdentities("Kamino", [{ name: "Marius" }], "@KaminoCrypto");
    const keys = cacheGet.mock.calls.map(([key]) => String(key));
    expect(new Set(keys).size).toBe(2);
    expect(keys.every((key) => /kamino(finance|crypto)/.test(key))).toBe(true);
  });
});

describe("bio description URLs are leads, never official scopes (ID-2)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("keeps a bio link to the real project's site out of officialWebsites", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "twitter-test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({
      data: {
        id: "424242",
        name: "Uniswap Fans",
        followers: 900,
        description: "Unofficial fan page. Not affiliated. uniswap.org",
        entities: { description: { urls: [{ expanded_url: "https://uniswap.org/" }] } },
      },
    })));
    const profile = await getProfile("@uniswapfans");
    expect(profile).toEqual(expect.objectContaining({
      accountStatus: "active",
      userId: "424242",
      officialWebsites: [],
      bioWebsites: ["https://uniswap.org/"],
    }));
    expect(profile?.website).toBeUndefined();
  });
});
