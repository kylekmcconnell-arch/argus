import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyEvidence } from "../../src/data/evidence";
import { getCost, withCostLedger } from "../cost";
import { enrichPerson, peopledatalabsAdapter } from "./peopledatalabs";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

describe("People Data Labs provider attempt accounting", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("records one succeeded, billed attempt after a usable match", async () => {
    vi.stubEnv("PDL_API_KEY", "pdl-test-key");
    const fetchMock = vi.fn().mockResolvedValue(json({
      data: {
        full_name: "Ada Lovelace",
        job_title: "Founder",
        job_company_name: "Analytical Engines",
        experience: [],
      },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const captured = await withCostLedger(async () => ({
      result: await enrichPerson({ name: "Ada Lovelace" }),
      cost: getCost(),
    }));

    expect(captured.result?.fullName).toBe("Ada Lovelace");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(captured.cost.calls).toEqual([
      expect.objectContaining({
        provider: "peopledatalabs",
        op: "person/enrich",
        calls: 1,
        succeeded: 1,
        partial: 0,
        failed: 0,
        status: "succeeded",
        usd: 0.1,
      }),
    ]);
  });

  it("records a valid no-match response as one succeeded, free attempt", async () => {
    vi.stubEnv("PDL_API_KEY", "pdl-test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ data: null })));

    const captured = await withCostLedger(async () => ({
      result: await enrichPerson({ profile: "twitter.com/unknown" }),
      cost: getCost(),
    }));

    expect(captured.result).toBeNull();
    expect(captured.cost.calls).toEqual([
      expect.objectContaining({
        calls: 1,
        succeeded: 1,
        partial: 0,
        failed: 0,
        usd: 0,
        meta: expect.stringContaining("no_match"),
      }),
    ]);
  });

  it.each([
    {
      name: "transport failure",
      response: () => Promise.reject(new Error("offline")),
      meta: "transport_error",
    },
    {
      name: "HTTP failure",
      response: () => Promise.resolve(json({ error: "rate limited" }, 429)),
      meta: "http_429",
    },
    {
      name: "JSON parse failure",
      response: () => Promise.resolve(new Response("not-json", { status: 200 })),
      meta: "response_json_error",
    },
  ])("records $name exactly once as failed", async ({ response, meta }) => {
    vi.stubEnv("PDL_API_KEY", "pdl-test-key");
    const fetchMock = vi.fn().mockImplementation(response);
    vi.stubGlobal("fetch", fetchMock);

    const captured = await withCostLedger(async () => ({
      result: await enrichPerson({ name: "Ada Lovelace" }),
      cost: getCost(),
    }));

    expect(captured.result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(captured.cost.calls).toEqual([
      expect.objectContaining({
        calls: 1,
        succeeded: 0,
        partial: 0,
        failed: 1,
        status: "failed",
        usd: 0,
        meta: expect.stringContaining(meta),
      }),
    ]);
  });

  it("records a parsed but incomplete person record as partial", async () => {
    vi.stubEnv("PDL_API_KEY", "pdl-test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({
      data: { job_title: "Founder", experience: "not-an-array" },
    })));

    const captured = await withCostLedger(async () => ({
      result: await enrichPerson({ name: "Ada Lovelace" }),
      cost: getCost(),
    }));

    expect(captured.result?.jobTitle).toBe("Founder");
    expect(captured.cost.calls).toEqual([
      expect.objectContaining({
        calls: 1,
        succeeded: 0,
        partial: 1,
        failed: 0,
        status: "partial",
        usd: 0.1,
        meta: expect.stringContaining("missing_full_name"),
      }),
    ]);
  });

  it("stores a licensed resolved name without replacing the X display name", async () => {
    vi.stubEnv("PDL_API_KEY", "pdl-test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({
      data: {
        full_name: "Ada Lovelace",
        linkedin_url: "linkedin.com/in/ada-lovelace",
        experience: [],
      },
    })));
    const evidence = emptyEvidence("@analytical_engine");
    evidence.profile.display_name = "Analytical Engine";

    await withCostLedger(() => peopledatalabsAdapter.run({
      handle: evidence.profile.handle,
      evidence,
      emit: vi.fn(),
      recordCheck: vi.fn(),
    }));

    expect(evidence.profile.display_name).toBe("Analytical Engine");
    expect(evidence.profile.resolved_name).toBe("Ada Lovelace");
    expect(evidence.profile.identity_confidence).toBe("Probable");
  });
});
