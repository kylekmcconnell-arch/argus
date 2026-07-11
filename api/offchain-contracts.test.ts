import { beforeEach, describe, expect, it, vi } from "vitest";

const { cacheGetJson, cacheSetJson } = vi.hoisted(() => ({
  cacheGetJson: vi.fn(),
  cacheSetJson: vi.fn(),
}));

vi.mock("./_cache.js", () => ({ cacheGetJson, cacheSetJson }));

import legalHandler from "./legal-screen";
import newsHandler from "./news";
import sanctionsHandler from "./sanctions-name";

const validOfacCache = (...leading: string[]) => [
  ...leading,
  ...Array.from({ length: 5_000 - leading.length }, (_, index) => `test person ${index}`),
].join("\n");

function response() {
  const captured: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) { captured.status = code; return this; },
    json(body: unknown) { captured.body = body; return this; },
  };
  return { res, captured };
}

describe("off-chain API response compatibility", () => {
  beforeEach(() => {
    cacheGetJson.mockReset().mockResolvedValue(null);
    cacheSetJson.mockReset().mockResolvedValue(undefined);
    vi.unstubAllGlobals();
  });

  it("keeps the news payload shape", async () => {
    const rss = `<rss><channel><item><title>Kyle McConnell launches Argus - Example</title><source>Example</source><link>https://example.com/a</link><pubDate>Sat, 11 Jul 2026 12:00:00 GMT</pubDate><description>Kyle McConnell launches Argus.</description></item></channel></rss>`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(rss, { status: 200 })));
    const { res, captured } = response();

    await newsHandler({ query: { q: "Kyle McConnell", h: "" } } as never, res as never);

    expect(captured.status).toBe(200);
    expect(captured.body).toEqual({
      available: true,
      query: "Kyle McConnell",
      articles: [{
        title: "Kyle McConnell launches Argus",
        source: "Example",
        url: "https://example.com/a",
        publishedAt: Date.parse("Sat, 11 Jul 2026 12:00:00 GMT"),
      }],
    });
  });

  it("does not turn a malformed news response into a clean empty result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("challenge", { status: 200 })));
    const { res, captured } = response();

    await newsHandler({ query: { q: "Kyle McConnell", h: "" } } as never, res as never);

    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({ available: false, articles: [] });
  });

  it("keeps the legal payload shape and cache key", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      count: 1,
      results: [{ caseName: "Kyle McConnell v. Example", court: "D. Example", dateFiled: "2026-01-01", docketNumber: "1", docket_absolute_url: "/docket/1/" }],
    }), { status: 200, headers: { "content-type": "application/json" } })));
    const { res, captured } = response();

    await legalHandler({ query: { name: "Kyle McConnell" } } as never, res as never);

    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({
      available: true,
      name: "Kyle McConnell",
      total: 1,
      asParty: 1,
      cases: [{ caseName: "Kyle McConnell v. Example", nameInCase: true }],
    });
    expect(cacheSetJson).toHaveBeenCalledWith("legal:kyle mcconnell", captured.body);
  });

  it("does not turn malformed CourtListener JSON into a clean legal result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ count: 2 }), { status: 200 })));
    const { res, captured } = response();

    await legalHandler({ query: { name: "Kyle McConnell" } } as never, res as never);

    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({ available: false });
    expect(cacheSetJson).not.toHaveBeenCalled();
  });

  it("keeps the exact-name OFAC payload shape while reusing the cached index", async () => {
    cacheGetJson.mockResolvedValue({ names: validOfacCache("kyle mcconnell", "mcconnell kyle") });
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const { res, captured } = response();

    await sanctionsHandler({ query: { name: "Kyle McConnell" } } as never, res as never);

    expect(captured.status).toBe(200);
    expect(captured.body).toEqual({
      available: true,
      name: "Kyle McConnell",
      listSize: 5_000,
      sanctioned: true,
      list: "US Treasury OFAC SDN",
    });
    expect(cacheGetJson).toHaveBeenCalledWith("ofacname:v2");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
