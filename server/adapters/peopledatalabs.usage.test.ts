import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyEvidence } from "../../src/data/evidence";
import { SubjectClass, VentureOutcome } from "../../src/engine";
import { getCost, withCostLedger } from "../cost";
import { providerBackedRoles } from "../orchestrate";
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
    const signal = new AbortController().signal;
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(signal);
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
    expect(timeoutSpy).toHaveBeenCalledWith(10_000);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal }),
    );
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

  it("records a provider outage as unavailable coverage, never as a completed pseudonymous screen", async () => {
    vi.stubEnv("PDL_API_KEY", "pdl-test-key");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("socket hang up")));
    const evidence = emptyEvidence("@analytical_engine");
    const recordCheck = vi.fn();

    const result = await withCostLedger(() => peopledatalabsAdapter.run({
      handle: evidence.profile.handle,
      evidence,
      emit: vi.fn(),
      recordCheck,
    }));

    expect(recordCheck).toHaveBeenCalledWith(expect.objectContaining({
      id: "identity-resolution",
      status: "unavailable",
      note: expect.stringContaining("not pseudonymous"),
    }));
    expect(recordCheck).not.toHaveBeenCalledWith(expect.objectContaining({ status: "checked-empty" }));
    expect(result).toMatchObject({ state: "failed" });
    expect(evidence.profile.resolved_name).toBeUndefined();
  });

  it("still records a genuine provider no-match as a completed empty screen", async () => {
    vi.stubEnv("PDL_API_KEY", "pdl-test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ data: null })));
    const evidence = emptyEvidence("@analytical_engine");
    const recordCheck = vi.fn();

    await withCostLedger(() => peopledatalabsAdapter.run({
      handle: evidence.profile.handle,
      evidence,
      emit: vi.fn(),
      recordCheck,
    }));

    expect(recordCheck).toHaveBeenCalledWith(expect.objectContaining({
      id: "identity-resolution",
      status: "checked-empty",
    }));
  });

  it("stores a licensed resolved name without replacing the X display name", async () => {
    vi.stubEnv("PDL_API_KEY", "pdl-test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({
      data: {
        full_name: "Ada Lovelace",
        twitter_url: "twitter.com/analytical_engine",
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

  it("stamps new and corroborated ventures with exact PDL provenance", async () => {
    vi.stubEnv("PDL_API_KEY", "pdl-test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({
      data: {
        full_name: "Ada Lovelace",
        twitter_url: "twitter.com/ada",
        experience: [
          { company: { name: "Existing Co", website: "existing.example" }, title: { name: "Founder" } },
          { company: { name: "New Co", website: "new.example" }, title: { name: "Engineer" } },
        ],
      },
    })));
    const evidence = emptyEvidence("@ada");
    evidence.profile.display_name = "Ada Lovelace";
    evidence.ventures.push({
      project_name: "Existing Co",
      role: "claimed founder",
      period: "",
      outcome: VentureOutcome.UNKNOWN,
      evidence_origin: "model_lead",
      artifact_verified: false,
    });

    await withCostLedger(() => peopledatalabsAdapter.run({
      handle: evidence.profile.handle,
      evidence,
      emit: vi.fn(),
      recordCheck: vi.fn(),
    }));

    expect(evidence.ventures).toEqual(expect.arrayContaining([
      expect.objectContaining({ project_name: "Existing Co", role: "Founder", provider: "peopledatalabs", evidence_origin: "deterministic", artifact_verified: true }),
      expect.objectContaining({ project_name: "New Co", role: "Engineer", provider: "peopledatalabs", evidence_origin: "deterministic", artifact_verified: true }),
    ]));
  });

  it("replaces a model-claimed founder title with the PDL title on promotion, so it cannot become a provider-backed FOUNDER role", async () => {
    vi.stubEnv("PDL_API_KEY", "pdl-test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({
      data: {
        full_name: "Ada Lovelace",
        twitter_url: "twitter.com/ada",
        experience: [
          { company: { name: "Acme" }, title: { name: "Software Engineer" } },
        ],
      },
    })));
    const evidence = emptyEvidence("@ada");
    evidence.profile.display_name = "Ada Lovelace";
    evidence.ventures.push({
      project_name: "Acme",
      role: "Founder & CEO",
      period: "",
      outcome: VentureOutcome.UNKNOWN,
      evidence_origin: "model_lead",
      artifact_verified: false,
    });

    await withCostLedger(() => peopledatalabsAdapter.run({
      handle: evidence.profile.handle,
      evidence,
      emit: vi.fn(),
      recordCheck: vi.fn(),
    }));

    // The PDL record established employment, not the model-claimed title.
    expect(evidence.ventures).toEqual([
      expect.objectContaining({ project_name: "Acme", role: "Software Engineer", provider: "peopledatalabs", evidence_origin: "deterministic", artifact_verified: true }),
    ]);
    const roles = providerBackedRoles(evidence);
    expect(roles).not.toContain(SubjectClass.FOUNDER);
    expect(roles).toContain(SubjectClass.MEMBER);
  });

  it("leaves a venture already verified by another provider untouched apart from the corroboration note", async () => {
    vi.stubEnv("PDL_API_KEY", "pdl-test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({
      data: {
        full_name: "Ada Lovelace",
        twitter_url: "twitter.com/ada",
        experience: [
          { company: { name: "Acme" }, title: { name: "Engineer" } },
        ],
      },
    })));
    const evidence = emptyEvidence("@ada");
    evidence.profile.display_name = "Ada Lovelace";
    evidence.ventures.push({
      project_name: "Acme",
      role: "Founder",
      period: "2019-2023",
      outcome: VentureOutcome.UNKNOWN,
      notes: "founder title from registry filing",
      provider: "publicweb",
      evidence_origin: "deterministic",
      artifact_verified: true,
    });

    await withCostLedger(() => peopledatalabsAdapter.run({
      handle: evidence.profile.handle,
      evidence,
      emit: vi.fn(),
      recordCheck: vi.fn(),
    }));

    expect(evidence.ventures).toEqual([
      expect.objectContaining({
        project_name: "Acme",
        role: "Founder",
        provider: "publicweb",
        evidence_origin: "deterministic",
        artifact_verified: true,
        notes: expect.stringContaining("corroborated: PDL employment record"),
      }),
    ]);
  });

  it("rejects a name and company collision when the returned person is not bound to the audited X handle", async () => {
    vi.stubEnv("PDL_API_KEY", "pdl-test-key");
    const fetchMock = vi.fn().mockResolvedValue(json({
      data: {
        full_name: "Sam Altman",
        twitter_url: "twitter.com/sama",
        experience: [
          { company: { name: "OpenAI" }, title: { name: "CEO" } },
        ],
      },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const evidence = emptyEvidence("@unrelated_handle");
    evidence.profile.display_name = "Sam Altman";
    evidence.ventures.push({
      project_name: "OpenAI",
      role: "Founder",
      period: "",
      outcome: VentureOutcome.UNKNOWN,
      evidence_origin: "model_lead",
      artifact_verified: false,
    });
    const recordCheck = vi.fn();

    await withCostLedger(() => peopledatalabsAdapter.run({
      handle: evidence.profile.handle,
      evidence,
      emit: vi.fn(),
      recordCheck,
    }));

    expect(String(fetchMock.mock.calls[0][0])).toContain("profile=https%3A%2F%2Ftwitter.com%2Funrelated_handle");
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("company=OpenAI");
    expect(evidence.profile.resolved_name).toBeUndefined();
    expect(evidence.ventures).toEqual([
      expect.objectContaining({ project_name: "OpenAI", evidence_origin: "model_lead", artifact_verified: false }),
    ]);
    expect(recordCheck).toHaveBeenCalledWith(expect.objectContaining({
      id: "identity-resolution",
      status: "checked-empty",
      note: expect.stringContaining("exact audited X handle"),
    }));
  });

  it("does not let a person record replace an institutional fund account", async () => {
    vi.stubEnv("PDL_API_KEY", "pdl-test-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const evidence = emptyEvidence("@theformsvc");
    evidence.profile.display_name = "TheForms - Your Partner";
    evidence.profile.bio = "We back founders building infrastructure.";
    evidence.roles = [SubjectClass.INVESTOR];

    const result = await withCostLedger(() => peopledatalabsAdapter.run({
      handle: evidence.profile.handle,
      evidence,
      emit: vi.fn(),
      recordCheck: vi.fn(),
    }));

    expect(result).toEqual(expect.objectContaining({ state: "skipped" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(evidence.profile.resolved_name).toBeUndefined();
  });
});
