import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cacheGetJson, cacheSetJson } = vi.hoisted(() => ({
  cacheGetJson: vi.fn(),
  cacheSetJson: vi.fn(),
}));

vi.mock("./_cache.js", () => ({ cacheGetJson, cacheSetJson }));

import handler from "./site-infra";

type FailedProvider = "homepage" | "certspotter" | "urlscan";

function response() {
  const captured: { status?: number; body?: Record<string, unknown> } = {};
  const res = {
    status(code: number) { captured.status = code; return this; },
    json(body: Record<string, unknown>) { captured.body = body; return this; },
  };
  return { res, captured };
}

const request = { method: "GET", query: { domain: "example.com" }, headers: {} };

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function completedEmptyFetch(failed?: FailedProvider) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url === "https://example.com/") {
      return failed === "homepage"
        ? new Response("unavailable", { status: 503 })
        : new Response("<html><body>No analytics here</body></html>", { status: 200 });
    }
    if (url === "https://example.com/favicon.ico") return new Response("", { status: 404 });
    if (url.startsWith("https://api.certspotter.com/")) {
      return failed === "certspotter"
        ? new Response("unavailable", { status: 503 })
        : json([]);
    }
    if (url.includes("urlscan.io/api/v1/search/")) {
      return failed === "urlscan"
        ? new Response("unavailable", { status: 503 })
        : json({ results: [] });
    }
    throw new Error(`unexpected URL ${url}`);
  });
}

describe("site-infrastructure screen completeness", () => {
  beforeEach(() => {
    cacheGetJson.mockReset().mockResolvedValue(null);
    cacheSetJson.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["homepage", "homepage"],
    ["CertSpotter", "certspotter"],
    ["URLScan", "urlscan"],
  ] as const)("does not publish a no-links result when %s failed", async (_label, failed) => {
    vi.stubGlobal("fetch", completedEmptyFetch(failed));
    const { res, captured } = response();

    await handler(request as never, res as never);

    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({ available: false, host: "example.com" });
    expect(captured.body).not.toHaveProperty("hasLinks");
    expect(cacheSetJson).not.toHaveBeenCalled();
  });

  it("preserves a completed three-provider empty screen as measured no links", async () => {
    vi.stubGlobal("fetch", completedEmptyFetch());
    const { res, captured } = response();

    await handler(request as never, res as never);

    expect(captured.body).toMatchObject({
      available: true,
      host: "example.com",
      fingerprints: [],
      siblings: [],
      hasLinks: false,
      hosting: { available: true, cdn: false, neighbors: [] },
    });
    expect(cacheSetJson).toHaveBeenCalledWith(
      "siteinfra:example.com:v3",
      expect.objectContaining({ available: true, hasLinks: false }),
    );
  });

  it("treats a failed dedicated-IP neighbor pivot as an incomplete URLScan read", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://example.com/") return new Response("<html></html>", { status: 200 });
      if (url === "https://example.com/favicon.ico") return new Response("", { status: 404 });
      if (url.startsWith("https://api.certspotter.com/")) return json([]);
      if (url.includes("page.domain:")) return json({ results: [{ page: { ip: "203.0.113.7", asnname: "Example Hosting" } }] });
      if (url.includes("page.ip:")) return new Response("unavailable", { status: 503 });
      throw new Error(`unexpected URL ${url}`);
    }));
    const { res, captured } = response();

    await handler(request as never, res as never);

    expect(captured.body).toMatchObject({ available: false, failedChecks: ["hosting"] });
    expect(cacheSetJson).not.toHaveBeenCalled();
  });
});
