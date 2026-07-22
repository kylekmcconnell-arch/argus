import { afterEach, describe, expect, it, vi } from "vitest";
import { describeOutcomeDelta, readPriorOutcome } from "./priorOutcome";

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("readPriorOutcome", () => {
  const ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ENV };
    vi.restoreAllMocks();
  });

  it("resolves the case then the latest version, tolerating @-prefixed refs", async () => {
    process.env.SUPABASE_URL = "https://db.example.supabase.co";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(String(url));
      if (String(url).includes("/rest/v1/cases")) return jsonResponse([{ id: "case-1" }]);
      return jsonResponse([{ version: 6, score: 75, verdict: "PASS", completeness_state: "complete", created_at: "2026-07-22T03:09:00.000Z" }]);
    }));

    const prior = await readPriorOutcome("11111111-1111-1111-1111-111111111111", "@Uniswap");
    expect(prior).toEqual({
      version: 6,
      score: 75,
      verdict: "PASS",
      completeness: "complete",
      capturedAt: "2026-07-22T03:09:00.000Z",
    });
    expect(urls[0]).toContain("kind=eq.person");
    expect(urls[1]).toContain("order=version.desc&limit=1");
  });

  it("returns null without credentials, an org, or a stored case (never throws)", async () => {
    delete process.env.SUPABASE_URL;
    expect(await readPriorOutcome("org", "@x")).toBe(null);

    process.env.SUPABASE_URL = "https://db.example.supabase.co";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
    expect(await readPriorOutcome(undefined, "@x")).toBe(null);

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([])));
    expect(await readPriorOutcome("org", "@x")).toBe(null);
  });
});

describe("describeOutcomeDelta", () => {
  const prior = { version: 5, score: 74, verdict: "PASS", completeness: "partial", capturedAt: "2026-07-21T18:00:00.000Z" };

  it("states verdict, score, and coverage movement in one line", () => {
    expect(describeOutcomeDelta(prior, { score: 90, verdict: "PASS", completeness: "complete" }))
      .toBe("Since last scan (v5, 2026-07-21): score 74 -> 90 (+16) · coverage partial -> complete");
  });

  it("reports a steady score honestly", () => {
    expect(describeOutcomeDelta(prior, { score: 74, verdict: "PASS", completeness: "partial" }))
      .toBe("Since last scan (v5, 2026-07-21): score steady at 74");
  });

  it("returns null when there is nothing comparable to say", () => {
    expect(describeOutcomeDelta(
      { version: 1, score: null, verdict: null, completeness: null, capturedAt: null },
      { score: null, verdict: "PASS", completeness: "complete" },
    )).toBe(null);
  });
});
