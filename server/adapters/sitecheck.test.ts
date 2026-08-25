import { afterEach, describe, expect, it, vi } from "vitest";

import { getCost, withCostLedger } from "../cost";
import { checkSiteSubstance, isConfirmedOfficialSiteAccessDenial, officialSiteAccessDeniedFinding } from "./sitecheck";

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

// A body delivered chunk by chunk, counting how much of it the reader actually
// pulled. That count is the whole point: a capped read must leave the tail of a
// large bundle untransferred, and only a streamed fixture can prove it.
const streamedResponse = (
  chunks: string[],
  contentType: string,
  pulled: { chunks: number },
) => {
  let index = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index >= chunks.length) {
          controller.close();
          return;
        }
        pulled.chunks += 1;
        controller.enqueue(new TextEncoder().encode(chunks[index]));
        index += 1;
      },
    }),
    { status: 200, headers: { "content-type": contentType } },
  );
};

const SHELL = '<div id="root"></div><script type="module" src="/app.js"></script>';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("checkSiteSubstance attribution", () => {
  it("states a confirmed official-site block without claiming the page was read", () => {
    expect(officialSiteAccessDeniedFinding("earnonhood.com")).toBe(
      "The official site (earnonhood.com) blocked the automated request, so ARGUS could not read the page. No adverse site-activity conclusion was drawn from that block alone.",
    );
    expect(officialSiteAccessDeniedFinding("https://www.earnonhood.com/omni")).toContain("www.earnonhood.com");
    expect(officialSiteAccessDeniedFinding("earnonhood.com")).not.toMatch(/live|successful|Dashboard|docs/i);
    expect(isConfirmedOfficialSiteAccessDenial({
      status: "access_blocked",
      reason: "http_access",
      detail: "the site denied the automated liveness request (HTTP 403)",
    })).toBe(true);
    expect(isConfirmedOfficialSiteAccessDenial({
      status: "access_blocked",
      reason: "http_access",
      detail: "the site denied the automated liveness request (HTTP 401)",
    })).toBe(true);
    expect(isConfirmedOfficialSiteAccessDenial({
      status: "access_blocked",
      reason: "anti_bot",
      detail: "the site served an anti-bot challenge instead of its homepage (HTTP 200)",
    })).toBe(true);
    expect(isConfirmedOfficialSiteAccessDenial({
      status: "access_blocked",
      reason: "rate_limit",
      detail: "the site rate-limited the automated liveness request (HTTP 429)",
    })).toBe(false);
    expect(isConfirmedOfficialSiteAccessDenial({
      status: "access_blocked",
      reason: "http_access",
      detail: "the site rate-limited the automated liveness request (HTTP 429)",
    })).toBe(false);
  });

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
      reason: status === 429 ? "rate_limit" : "http_access",
    });
    expect(captured.result?.detail).toContain(`HTTP ${status}`);
    expect(captured.cost.calls).toContainEqual(expect.objectContaining({
      provider: "site-fetch",
      op: "substance",
      calls: status === 403 ? 4 : 2,
      partial: status === 403 ? 4 : 2,
      failed: 0,
      meta: expect.stringContaining(`http_${status}_access_blocked`),
    }));
  });

  it("keeps a confirmed earnonhood.com HTTP 403 as access blocked after the bounded retry, never live", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(response("request denied", 403)));
    vi.stubGlobal("fetch", fetchMock);

    const captured = await withCostLedger(async () => ({
      result: await checkSiteSubstance("earnonhood.com"),
      cost: getCost(),
    }));

    expect(captured.result).toMatchObject({
      status: "access_blocked",
      reason: "http_access",
      detail: expect.stringContaining("HTTP 403"),
    });
    expect(captured.result?.status).not.toBe("live");
    expect(captured.result?.detail).not.toMatch(/live site|Dashboard|docs/i);
    expect(officialSiteAccessDeniedFinding("earnonhood.com")).toContain("could not read the page");
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://earnonhood.com",
      "https://earnonhood.com",
      "https://www.earnonhood.com",
      "https://www.earnonhood.com",
    ]);
    expect(captured.cost.calls).toContainEqual(expect.objectContaining({
      provider: "site-fetch",
      op: "substance",
      meta: expect.stringContaining("http_403_access_blocked_retry"),
    }));
    expect(captured.cost.calls).toContainEqual(expect.objectContaining({
      provider: "site-fetch",
      op: "substance",
      meta: expect.stringContaining("http_403_access_blocked"),
    }));
  });

  it("recovers when a public project site returns one transient HTTP 403", async () => {
    const product = `Dashboard docs governance staking. ${"A working product surface for customers and builders. ".repeat(12)}`;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response("request denied", 403))
      .mockResolvedValueOnce(response(`<html><body>${product}</body></html>`));
    vi.stubGlobal("fetch", fetchMock);

    const captured = await withCostLedger(async () => ({
      result: await checkSiteSubstance("example.org"),
      cost: getCost(),
    }));

    expect(captured.result).toMatchObject({ status: "live" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(captured.cost.calls).toContainEqual(expect.objectContaining({
      provider: "site-fetch",
      op: "substance",
      calls: 2,
      succeeded: 1,
      partial: 1,
      meta: expect.stringContaining("http_403_access_blocked_retry"),
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
      .mockResolvedValueOnce(response("denied again", 403))
      .mockResolvedValueOnce(response(`<html><body>${product}</body></html>`));
    vi.stubGlobal("fetch", fetchMock);

    await expect(checkSiteSubstance("example.org")).resolves.toMatchObject({ status: "live" });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://example.org",
      "https://example.org",
      "https://www.example.org",
    ]);
  });

  it("falls back from an explicit www host to the bare host without constructing www.www", async () => {
    const product = `Dashboard docs governance staking. ${"A working product surface for customers and builders. ".repeat(12)}`;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response("denied", 403))
      .mockResolvedValueOnce(response("denied again", 403))
      .mockResolvedValueOnce(response(`<html><body>${product}</body></html>`));
    vi.stubGlobal("fetch", fetchMock);

    await expect(checkSiteSubstance("www.example.org")).resolves.toMatchObject({ status: "live" });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://www.example.org",
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

  it("caps a huge script bundle instead of buffering all of it, and says the marker search was capped", async () => {
    // app.uniswap.org serves a 9.01 MB Vite chunk. The real scan buffered the
    // whole thing into a string to run one regex over it.
    const filler = "x".repeat(64 * 1024);
    const chunks = [...Array.from({ length: 39 }, () => filler), 'const route = "ComingSoonApp";'];
    const pulled = { chunks: 0 };
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response(SHELL))
      .mockResolvedValueOnce(streamedResponse(chunks, "application/javascript", pulled)));

    const captured = await withCostLedger(async () => ({
      result: await checkSiteSubstance("example.org"),
      cost: getCost(),
    }));

    // 512 KB of a 2.5 MB bundle (plus whatever the stream reads ahead): the
    // tail, marker and all, never crosses the wire.
    expect(pulled.chunks).toBeLessThanOrEqual(12);
    expect(captured.result).toMatchObject({ status: "client_rendered" });
    // The marker was never reached. Saying nothing about it would let a
    // truncated read pass for a completed one.
    expect(captured.result?.detail).not.toContain("unrendered coming-soon string");
    expect(captured.result?.detail).toContain("read only up to");
    expect(captured.cost.calls).toContainEqual(expect.objectContaining({
      provider: "site-fetch",
      op: "substance",
      calls: 2,
      succeeded: 1,
      partial: 1,
      meta: expect.stringContaining("read_capped"),
    }));
  });

  it("stops walking bundles once one of them already carries a coming-soon marker", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(
        '<div id="root"></div><script type="module" src="/a.js"></script><script type="module" src="/b.js"></script>',
      ))
      .mockResolvedValueOnce(response('const route = "ComingSoonApp";', 200, "application/javascript"))
      .mockResolvedValueOnce(response('const other = "ComingSoonApp";', 200, "application/javascript"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(checkSiteSubstance("example.org")).resolves.toMatchObject({
      status: "client_rendered",
      detail: expect.stringContaining("unrendered coming-soon string"),
    });
    // The hint cannot get any stronger, so the second bundle is never bought.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not claim a capped bundle read found nothing when a smaller bundle answered first", async () => {
    // A fully read bundle keeps the plain wording: only a truncated read is a floor.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(SHELL))
      .mockResolvedValueOnce(response("const app = 1;", 200, "application/javascript"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await checkSiteSubstance("example.org");
    expect(result?.detail).toContain("static read could not confirm");
    expect(result?.detail).not.toContain("read only up to");
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
