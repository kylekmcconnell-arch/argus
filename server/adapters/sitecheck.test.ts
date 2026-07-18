import { afterEach, describe, expect, it, vi } from "vitest";

import { getCost, withCostLedger } from "../cost";
import { checkSiteSubstance } from "./sitecheck";

const response = (
  body: string | null,
  status = 200,
  contentType = "text/html",
  headers: Record<string, string> = {},
) => new Response(body, {
  status,
  headers: { "content-type": contentType, ...headers },
});

const dnsError = (code = "ENOTFOUND") => Object.assign(
  new TypeError("fetch failed"),
  { cause: { code } },
);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("checkSiteSubstance attribution", () => {
  it("ignores invalid domains without making a provider attempt", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(checkSiteSubstance("not-a-domain")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([401, 403, 429])("classifies HTTP %i as access blocked, never unreachable", async (status) => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(response("request denied", status)));
    vi.stubGlobal("fetch", fetchMock);

    const captured = await withCostLedger(async () => ({
      result: await checkSiteSubstance("example.org"),
      cost: getCost(),
    }));

    expect(captured.result).toMatchObject({
      status: "access_blocked",
      reason: "http_access",
    });
    expect(captured.result?.detail).toContain(`HTTP ${status}`);
    expect(captured.cost.calls).toContainEqual(expect.objectContaining({
      provider: "site-fetch",
      op: "substance",
      calls: 2,
      partial: 2,
      failed: 0,
      meta: expect.stringContaining(`http_${status}_access_blocked`),
    }));
  });

  it.each([200, 503])("classifies an HTTP %i anti-bot challenge as access blocked", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(response(
      "<html><title>Just a moment...</title><script src='/cdn-cgi/challenge-platform/a.js'></script></html>",
      status,
    ))));

    await expect(checkSiteSubstance("example.org")).resolves.toMatchObject({
      status: "access_blocked",
      reason: "anti_bot",
      detail: expect.stringContaining(`HTTP ${status}`),
    });
  });

  it("recognizes an anti-bot challenge header even when the response is HTTP 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(response(
      "<html><body>Loading</body></html>",
      200,
      "text/html",
      { "cf-mitigated": "challenge" },
    ))));

    await expect(checkSiteSubstance("example.org")).resolves.toMatchObject({
      status: "access_blocked",
      reason: "anti_bot",
    });
  });

  it.each([404, 500, 503])("keeps an ordinary HTTP %i failure unavailable, not unreachable", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(response("ordinary server response", status))));

    await expect(checkSiteSubstance("example.org")).resolves.toMatchObject({
      status: "unavailable",
      reason: "http",
      detail: expect.stringContaining(`HTTP ${status}`),
    });
  });

  it("keeps a non-HTML homepage response unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(response("{}", 200, "application/json"))));

    await expect(checkSiteSubstance("example.org")).resolves.toMatchObject({
      status: "unavailable",
      reason: "content",
      detail: expect.stringContaining("not HTML"),
    });
  });

  it("keeps an empty homepage response unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(response(""))));

    await expect(checkSiteSubstance("example.org")).resolves.toMatchObject({
      status: "unavailable",
      reason: "content",
      detail: expect.stringContaining("empty body"),
    });
  });

  it("preserves DNS resolution failure as an unreachable DNS outcome", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(dnsError()));

    await expect(checkSiteSubstance("example.org")).resolves.toMatchObject({
      status: "unreachable",
      reason: "dns",
      detail: expect.stringContaining("DNS resolution failed"),
    });
  });

  it("preserves non-DNS transport failure as a distinct unreachable outcome", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("socket reset")));

    await expect(checkSiteSubstance("example.org")).resolves.toMatchObject({
      status: "unreachable",
      reason: "transport",
      detail: expect.stringContaining("transport requests failed"),
    });
  });

  it("reports mixed DNS and transport failures without collapsing either", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockRejectedValueOnce(dnsError("EAI_AGAIN"))
      .mockRejectedValueOnce(new Error("request timed out")));

    await expect(checkSiteSubstance("example.org")).resolves.toMatchObject({
      status: "unreachable",
      reason: "dns_and_transport",
      detail: expect.stringContaining("DNS resolution and transport attempts"),
    });
  });

  it("uses a successful www fallback instead of treating the apex access block as liveness evidence", async () => {
    const product = `Dashboard docs governance staking. ${"A working product surface for customers and builders. ".repeat(12)}`;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response("denied", 403))
      .mockResolvedValueOnce(response(`<html><body>${product}</body></html>`));
    vi.stubGlobal("fetch", fetchMock);

    await expect(checkSiteSubstance("example.org")).resolves.toMatchObject({ status: "live" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back from an explicit www host to the bare host without constructing www.www", async () => {
    const product = `Dashboard docs governance staking. ${"A working product surface for customers and builders. ".repeat(12)}`;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response("denied", 403))
      .mockResolvedValueOnce(response(`<html><body>${product}</body></html>`));
    vi.stubGlobal("fetch", fetchMock);

    await expect(checkSiteSubstance("www.example.org")).resolves.toMatchObject({ status: "live" });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://www.example.org",
      "https://example.org",
    ]);
  });

  it("prefers a received HTTP result over an alternate-host DNS failure", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockRejectedValueOnce(dnsError())
      .mockResolvedValueOnce(response("missing", 404)));

    await expect(checkSiteSubstance("example.org")).resolves.toMatchObject({
      status: "unavailable",
      reason: "http",
    });
  });

  it("recognizes a served registrar parking page as verified not-live evidence", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(
      "<html><body>This domain is for sale. Buy this domain today.</body></html>",
    )));

    await expect(checkSiteSubstance("example.org")).resolves.toMatchObject({
      status: "coming_soon",
      reason: "parked",
      detail: expect.stringContaining("parking"),
    });
  });

  it("recognizes explicit served coming-soon metadata as verified not-live evidence", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(
      '<html><head><title>Example is coming soon</title><meta content="Join the waitlist" name="description"></head><body>Get notified</body></html>',
    )));

    await expect(checkSiteSubstance("example.org")).resolves.toMatchObject({
      status: "coming_soon",
      reason: "coming_soon",
      detail: expect.stringContaining("explicitly presents"),
    });
  });

  it("does not call a substantial live product site not-live because it mentions a feature waitlist", async () => {
    const product = [
      "Dashboard docs governance staking marketplace features.",
      "Join the waitlist for our optional beta notification feature.",
      "Customers can connect wallet, deposit, withdraw, and use the live explorer today.",
      "Independent documentation, pricing, and whitepaper resources are available.",
      "Operational product information. ".repeat(16),
    ].join(" ");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(`<html><body>${product}</body></html>`)));

    await expect(checkSiteSubstance("example.org")).resolves.toMatchObject({ status: "live" });
  });

  it("keeps a substantial live product site live when its meta mentions a launching-soon feature", async () => {
    const product = [
      "Trade on-chain perps with the live order book, deposit, withdraw, staking, and governance.",
      "Documentation, pricing, and whitepaper resources are available today.",
      "Operational product information. ".repeat(16),
    ].join(" ");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(
      `<html><head><title>Example DEX</title><meta content="Trade on-chain perps. Mobile app launching soon." name="description"></head><body>${product}</body></html>`,
    )));

    await expect(checkSiteSubstance("example.org")).resolves.toMatchObject({ status: "live" });
  });

  it("keeps a live page live when a bot-mitigation script tag appears without an interstitial", async () => {
    const product = [
      "Dashboard docs governance staking marketplace features live today.",
      "Connect wallet, deposit, withdraw, and use the explorer in just a moment.",
      "Operational product information. ".repeat(16),
    ].join(" ");
    // Cloudflare Bot Fight Mode injects challenge-platform scripts into ordinary
    // 200 pages; only title-plus-runtime or runtime-plus-human-prompt is a real
    // interstitial.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(
      `<html><head><title>Example DEX</title><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script></head><body>${product}</body></html>`,
    )));

    await expect(checkSiteSubstance("example.org")).resolves.toMatchObject({ status: "live" });
  });

  it("keeps bundle-only coming-soon strings neutral for a client-rendered shell", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response('<div id="root"></div><script type="module" src="/app.js"></script>'))
      .mockResolvedValueOnce(response('const route = "ComingSoonApp";', 200, "application/javascript"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(checkSiteSubstance("example.org")).resolves.toMatchObject({
      status: "client_rendered",
      detail: expect.stringContaining("unrendered coming-soon string"),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not let a blocked bundle turn an accessible app shell into an access-blocked homepage", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response('<div id="root"></div><script type="module" src="/app.js"></script>'))
      .mockResolvedValueOnce(response("forbidden", 403, "application/javascript"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(checkSiteSubstance("example.org")).resolves.toMatchObject({
      status: "client_rendered",
      detail: expect.stringContaining("static read could not confirm"),
    });
  });
});
