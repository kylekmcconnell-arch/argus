import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cacheGet, cacheSet, cacheStore } = vi.hoisted(() => ({
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  cacheStore: new Map<string, string>(),
}));

vi.mock("../cache", () => ({ cacheGet, cacheSet }));

import { dynamicNotable, notableFollowers } from "./x";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("dynamic X notable tenant isolation", () => {
  beforeEach(() => {
    cacheStore.clear();
    cacheGet.mockReset();
    cacheSet.mockReset();
    cacheGet.mockImplementation(async (key: string) => cacheStore.get(key) ?? null);
    cacheSet.mockImplementation(async (key: string, value: string) => {
      cacheStore.set(key, value);
    });
    vi.stubEnv("SUPABASE_URL", "https://database.example/");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-test-key");
    vi.stubEnv("SUPABASE_SERVICE_KEY", "");
    vi.stubEnv("TWITTERAPI_KEY", "twitterapi-test-key");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("queries PASS person reports with one exact encoded organization boundary", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json([
      { ref: "@TenantAlphaSignal", score: 92 },
      { ref: "not a valid handle", score: 99 },
      { ref: null, score: 100 },
    ]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await dynamicNotable("  org/a?tenant  ");

    expect(result).toEqual([{ handle: "TenantAlphaSignal", label: "ARGUS-verified" }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input] = fetchMock.mock.calls[0];
    const url = new URL(String(input));
    expect(`${url.origin}${url.pathname}`).toBe("https://database.example/rest/v1/reports");
    expect(url.searchParams.get("organization_id")).toBe("eq.org/a?tenant");
    expect(url.searchParams.get("kind")).toBe("eq.person");
    expect(url.searchParams.get("verdict")).toBe("eq.PASS");
    expect(cacheGet).not.toHaveBeenCalled();
    expect(cacheSet).not.toHaveBeenCalled();
  });

  it("fails closed without an organization and never attempts an unscoped reports read", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/twitter/user/followers?")) {
        return json({
          followers: [{ userName: "TenantAlphaSignal" }],
          has_next_page: false,
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(dynamicNotable()).resolves.toEqual([]);
    await expect(dynamicNotable("   ")).resolves.toEqual([]);
    const scan = await notableFollowers("@subject", { followerCount: 1 });

    expect(scan.list).toEqual([]);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/rest/v1/reports"))).toBe(false);
    expect(cacheGet).not.toHaveBeenCalled();
    expect(cacheSet).not.toHaveBeenCalled();
  });

  it("does not reuse a global cache or contaminate one organization with another", async () => {
    const reportQueries: string[] = [];
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/rest/v1/reports?")) {
        reportQueries.push(url);
        if (url.includes("organization_id=eq.org-a")) {
          return json([{ ref: "TenantAlphaSignal", score: 95 }]);
        }
        if (url.includes("organization_id=eq.org-b")) {
          return json([{ ref: "TenantBetaSignal", score: 96 }]);
        }
        throw new Error(`unscoped or unknown reports query: ${url}`);
      }
      if (url.includes("/twitter/user/followers?")) {
        return json({
          followers: [
            { userName: "TenantAlphaSignal" },
            { userName: "TenantBetaSignal" },
          ],
          has_next_page: false,
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const alpha = await notableFollowers("@subject", {
      followerCount: 1,
      organizationId: "org-a",
    });
    const beta = await notableFollowers("@subject", {
      followerCount: 1,
      organizationId: "org-b",
    });

    expect(alpha.list).toContainEqual({ handle: "TenantAlphaSignal", label: "ARGUS-verified", size: "" });
    expect(alpha.list.some((item) => item.handle === "TenantBetaSignal")).toBe(false);
    expect(beta.list).toContainEqual({ handle: "TenantBetaSignal", label: "ARGUS-verified", size: "" });
    expect(beta.list.some((item) => item.handle === "TenantAlphaSignal")).toBe(false);
    expect(reportQueries).toHaveLength(2);
    expect(reportQueries[0]).toContain("organization_id=eq.org-a");
    expect(reportQueries[1]).toContain("organization_id=eq.org-b");
    expect(cacheGet).not.toHaveBeenCalledWith("notable:dynamic");
    expect(cacheSet).not.toHaveBeenCalledWith("notable:dynamic", expect.any(String));
    expect(cacheStore.has("notable:dynamic")).toBe(false);
  });
});
