import { afterEach, describe, expect, it, vi } from "vitest";

import handler from "./site-history";

function response() {
  const captured: { status?: number; body?: any } = {};
  const res = {
    status(code: number) { captured.status = code; return this; },
    json(body: unknown) { captured.body = body; return this; },
  };
  return { res, captured };
}

async function run() {
  const { res, captured } = response();
  const pending = handler({ query: { url: "new-project.example" } } as never, res as never);
  await vi.runAllTimersAsync();
  await pending;
  return captured;
}

const emptyCdx = () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
const emptyAvailability = () => new Response(JSON.stringify({
  url: "new-project.example",
  archived_snapshots: {},
}), { status: 200, headers: { "content-type": "application/json" } });

describe("GET /api/site-history", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("fails closed when CDX never completes", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/cdx/search/cdx")) return new Response("unavailable", { status: 503 });
      if (url.includes("/wayback/available")) return emptyAvailability();
      throw new Error(`unexpected fetch ${url}`);
    }));

    const { status, body } = await run();

    expect(status).toBe(200);
    expect(body).toMatchObject({ domain: "new-project.example", available: false });
    expect(body.error).toContain("CDX: HTTP 503");
    expect(body.note).not.toContain("No archived history");
  });

  it("fails closed when the Wayback availability lookup never completes", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/cdx/search/cdx")) return emptyCdx();
      if (url.includes("/wayback/available")) return new Response("unavailable", { status: 503 });
      throw new Error(`unexpected fetch ${url}`);
    }));

    const { status, body } = await run();

    expect(status).toBe(200);
    expect(body).toMatchObject({ domain: "new-project.example", available: false });
    expect(body.error).toContain("availability: HTTP 503");
    expect(body.note).not.toContain("No archived history");
  });

  it.each([
    ["CDX", "not-json", emptyAvailability],
    ["availability", "[]", () => new Response("not-json", { status: 200 })],
  ])("does not treat a malformed %s response as a clean empty result", async (failedLookup, cdxBody, availabilityResponse) => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/cdx/search/cdx")) return new Response(cdxBody, { status: 200 });
      if (url.includes("/wayback/available")) return availabilityResponse();
      throw new Error(`unexpected fetch ${url}`);
    }));

    const { body } = await run();

    expect(body.available).toBe(false);
    expect(body.error).toContain(`${failedLookup}:`);
    expect(body.note).not.toContain("No archived history");
  });

  it("preserves a measured empty result when both Archive lookups complete successfully", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/cdx/search/cdx")) return emptyCdx();
      if (url.includes("/wayback/available")) return emptyAvailability();
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { status, body } = await run();

    expect(status).toBe(200);
    expect(body).toEqual({
      domain: "new-project.example",
      available: true,
      note: "No archived history found for this domain (very new, or never crawled by archive.org).",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
