import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverOperatorsFromFollowings, operatorClaimInBio } from "./x";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// The $LINKR case: a fresh launchpad project with no team page, no press and
// no CoinGecko listing. Its X account follows exactly one account, whose bio
// says "Building @linkrbot". Two first-party signals crossing.
describe("operatorClaimInBio", () => {
  it("reads the real dev bio that ARGUS missed", () => {
    const claim = operatorClaimInBio(
      "Shipping web3 tools & ideas | Dev since 08 | AI nerd\nBuilding @linkrbot | @uapenfts",
      "@linkrbot",
      "Linkr",
    );
    expect(claim).not.toBeNull();
    expect(claim!.role).toBe("operator");
    expect(claim!.phrase).toContain("Building @linkrbot");
  });

  it("accepts the verb on either side and types the role from the verb", () => {
    expect(operatorClaimInBio("co-founder of @acme", "@acme")?.role).toBe("co-founder");
    expect(operatorClaimInBio("@acme dev", "@acme")?.role).toBe("developer");
    expect(operatorClaimInBio("creator of @acme", "@acme")?.role).toBe("creator");
    expect(operatorClaimInBio("working on @acme", "@acme")?.role).toBe("operator");
  });

  it("matches a distinctive display name, never a short collision-prone one", () => {
    expect(operatorClaimInBio("building Linkr full time", "@linkrbot", "Linkr")).not.toBeNull();
    // A 3-char name must not let "building UNI" claim @uniswap.
    expect(operatorClaimInBio("building UNI positions", "@uniswap", "UNI")).toBeNull();
  });

  it("rejects bios that merely mention the project without claiming to build it", () => {
    expect(operatorClaimInBio("bullish on @linkrbot", "@linkrbot")).toBeNull();
    expect(operatorClaimInBio("@linkrbot is my favorite tool", "@linkrbot")).toBeNull();
    expect(operatorClaimInBio("investor | trader | @linkrbot holder", "@linkrbot")).toBeNull();
    // A builder of a DIFFERENT project must not be attributed to this one.
    expect(operatorClaimInBio("building @otherproject", "@linkrbot")).toBeNull();
    expect(operatorClaimInBio("", "@linkrbot")).toBeNull();
  });

  it("binds COO / CEO / we-built language next to the subject handle", () => {
    expect(["coo", "co-founder"]).toContain(operatorClaimInBio("Co-founder, COO @acme · @orghandle fund", "@acme")?.role);
    expect(operatorClaimInBio("COO @acme", "@acme")?.role).toBe("coo");
    expect(operatorClaimInBio("CEO @acme", "@acme")?.role).toBe("ceo");
    expect(operatorClaimInBio("we built @acme with friends", "@acme")?.role).toBe("founder");
    expect(operatorClaimInBio("I built @acme", "@acme")?.role).toBe("founder");
    // Building remains operator — do not treat the substring "built" as founder.
    expect(operatorClaimInBio("Building @linkrbot | @uapenfts", "@linkrbot")?.role).toBe("operator");
  });
});

describe("discoverOperatorsFromFollowings", () => {
  const followingsResponse = (users: unknown[], hasNext = false) => new Response(
    JSON.stringify({ followings: users, has_next_page: hasNext, next_cursor: hasNext ? "c1" : "" }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

  it("returns the dev with both crossing signals in its evidence, plus their other projects", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "tw-key");
    const fetchMock = vi.fn(async (input?: unknown) => {
      void input;
      return followingsResponse([
      { userName: "S0Ldev", name: "S0Ldev", description: "Shipping web3 tools & ideas | Dev since 08 | AI nerd\nBuilding @linkrbot | @uapenfts" },
      { userName: "randomfan", name: "Fan", description: "bullish on @linkrbot" },
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const team = await discoverOperatorsFromFollowings("@linkrbot", "Linkr");

    expect(team).toHaveLength(1);
    expect(team[0]).toMatchObject({
      handle: "@S0Ldev",
      kind: "team",
      sourceUrl: "https://x.com/S0Ldev",
    });
    expect(team[0].evidence).toContain("follows @S0Ldev");
    expect(team[0].evidence).toContain("Building @linkrbot");
    // The serial-launcher signal: the same bio names another project.
    expect(team[0].projects).toEqual([{ name: "@uapenfts" }]);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/twitter/user/followings?userName=linkrbot");
  });

  it("stays silent without a key, on a provider error, and when nobody claims the project", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "");
    expect(await discoverOperatorsFromFollowings("@linkrbot")).toEqual([]);

    vi.stubEnv("TWITTERAPI_KEY", "tw-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    expect(await discoverOperatorsFromFollowings("@linkrbot")).toEqual([]);

    vi.stubGlobal("fetch", vi.fn(async () => followingsResponse([
      { userName: "vc", name: "VC", description: "we invest in @linkrbot" },
    ])));
    expect(await discoverOperatorsFromFollowings("@linkrbot")).toEqual([]);
  });

  it("bounds the scan to two pages so a project following thousands cannot run away", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "tw-key");
    const fetchMock = vi.fn(async () => followingsResponse(
      [{ userName: "noise", name: "Noise", description: "gm" }],
      true,
    ));
    vi.stubGlobal("fetch", fetchMock);

    await discoverOperatorsFromFollowings("@bigproject");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
