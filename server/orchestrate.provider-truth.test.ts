import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyEvidence } from "../src/data/evidence";
import { providerStatus } from "./config";
import { addClaudeUsage, addGrokUsage, withCostLedger } from "./cost";
import { analystAttemptTotals, coldIntake, runAudit } from "./orchestrate";

const PROVIDER_ENV = [
  "ANTHROPIC_API_KEY",
  "BITQUERY_API_KEY",
  "COINGECKO_API_KEY",
  "CRUNCHBASE_API_KEY",
  "GITHUB_TOKEN",
  "HELIUS_API_KEY",
  "PDL_API_KEY",
  "REDDIT_CLIENT_ID",
  "REDDIT_CLIENT_SECRET",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_URL",
  "TWITTERAPI_KEY",
  "XAI_API_KEY",
] as const;

async function finishAudit(handle: string) {
  const pending = runAudit(handle, vi.fn());
  await vi.runAllTimersAsync();
  return pending;
}

describe("orchestrator provider execution truth", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    for (const key of PROVIDER_ENV) vi.stubEnv(key, "");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("counts Claude failure and Grok fallback as one analyst attempt trail", () => {
    const attempts = withCostLedger(() => {
      addClaudeUsage(undefined, "record_verdict", "failed", "http_400");
      addGrokUsage({ input_tokens: 120, output_tokens: 40 }, 0, "record_verdict", "succeeded");
      addGrokUsage({ input_tokens: 1, output_tokens: 1 }, 0, "unrelated-operation", "succeeded");
      return analystAttemptTotals(["record_verdict"]);
    });

    expect(attempts).toEqual({
      total: 2,
      succeeded: 1,
      partial: 0,
      failed: 1,
      cached: 0,
    });
  });


  it("keeps a fixture curated when Bitquery is the only configured credential", async () => {
    vi.stubEnv("BITQUERY_API_KEY", "configured-but-unused");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const dossier = await finishAudit("@satoshi_builds");
    const bitquery = providerStatus().find((provider) => provider.id === "bitquery");

    expect(bitquery).toMatchObject({
      configured: true,
      label: expect.stringContaining("not yet in core collector"),
      feeds: expect.stringContaining("does not run or attest"),
    });
    expect(dossier).toMatchObject({
      live: false,
      providerSnapshot: { runs: [] },
    });
    expect(dossier?.report.composite_verdict).toBe("PASS");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses pure fixture fallback when Helius has no applicable attributed Solana wallet", async () => {
    vi.stubEnv("HELIUS_API_KEY", "helius-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const dossier = await finishAudit("@satoshi_builds");

    expect(dossier?.live).toBe(false);
    expect(dossier?.report.composite_verdict).toBe("PASS");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never re-attests seeded fixture axes when a live provider runs without a fresh analyst", async () => {
    vi.stubEnv("GITHUB_TOKEN", "github-key");
    const fetchMock = vi.fn().mockResolvedValue(new Response("provider unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    const dossier = await finishAudit("@satoshi_builds");

    expect(fetchMock).toHaveBeenCalled();
    expect(dossier?.live).toBe(true);
    expect(dossier?.report.composite_verdict).toBe("INCOMPLETE");
    expect(dossier?.report.governing_score).toBeNull();
    expect(dossier?.completeness_state).toBe("partial");
    expect(dossier?.headline).toContain("Investigation incomplete");
    expect(dossier?.providerSnapshot?.runs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "github", state: "failed" }),
      expect.objectContaining({ id: "dexscreener", state: "skipped" }),
      expect.objectContaining({ id: "coingecko", state: "skipped" }),
      expect.objectContaining({ id: "token-lifecycle", state: "skipped" }),
    ]));
  });

  it("keeps model role candidates visible but publishes INCOMPLETE without provider-backed routing", async () => {
    vi.stubEnv("GITHUB_TOKEN", "github-key");
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-key");
    const fetchMock = vi.fn().mockResolvedValue(new Response("provider unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    const dossier = await finishAudit("@satoshi_builds");
    const anthropicTools = fetchMock.mock.calls.flatMap(([input, init]) => {
      if (!String(input).includes("api.anthropic.com")) return [];
      const request = JSON.parse(String(init?.body)) as { tool_choice?: { name?: string } };
      return request.tool_choice?.name ? [request.tool_choice.name] : [];
    });
    const analystRun = dossier?.providerSnapshot?.runs.find((run) => run.id === "ai-analyst");

    expect(dossier).toMatchObject({
      live: true,
      report: {
        composite_verdict: "INCOMPLETE",
        governing_score: null,
      },
    });
    expect(dossier?.report.role_reports.every((role) => Object.keys(role.axes).length === 0)).toBe(true);
    expect(dossier).not.toHaveProperty("axisCitationVersion");
    expect(dossier).not.toHaveProperty("axisEvidenceCatalog");
    expect(dossier?.headline).toContain("no provider-backed role selected a scoring methodology");
    expect(anthropicTools).not.toContain("record_contradictions");
    expect(anthropicTools).not.toContain("record_verdict");
    expect(analystRun).toMatchObject({
      label: "AI analyst",
      state: "skipped",
      detail: expect.stringContaining("no provider-backed methodology axes"),
    });
    expect(dossier?.report.investigative_leads).toEqual(expect.arrayContaining([
      expect.objectContaining({ finding_type: "RoleCandidate", evidence_origin: "model_lead" }),
    ]));
  });

  it("does not let a Grok-only founder affiliation request founder scoring", async () => {
    vi.stubEnv("XAI_API_KEY", "xai-key");
    vi.stubEnv("ARGUS_PROVIDER_FALLBACKS", "on");
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-key");
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("api.x.ai")) {
        return new Response(JSON.stringify({
          output_text: JSON.stringify({ affiliations: [{ name: "Model Venture", role: "founder", evidence: "model-only lead" }] }),
          usage: { input_tokens: 1, output_tokens: 1, num_sources_used: 1 },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("api.anthropic.com")) {
        const request = JSON.parse(String(init?.body)) as { tool_choice?: { name?: string } };
        const name = request.tool_choice?.name ?? "unknown";
        const toolInput = name === "record_claims"
          ? { roles: ["FOUNDER"], ventures: [], testimonials: [], advised: [], promotions: [] }
          : name === "record_contradictions"
            ? { contradictions: [] }
            : {};
        return new Response(JSON.stringify({
          content: [{ type: "tool_use", name, input: toolInput }],
          stop_reason: "tool_use",
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("provider unavailable", { status: 503 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const dossier = await finishAudit("@grok_only_founder");
    const anthropicTools = fetchMock.mock.calls.flatMap(([input, init]) => {
      if (!String(input).includes("api.anthropic.com")) return [];
      const request = JSON.parse(String(init?.body)) as { tool_choice?: { name?: string } };
      return request.tool_choice?.name ? [request.tool_choice.name] : [];
    });

    expect(dossier?.report.composite_verdict).toBe("INCOMPLETE");
    expect(dossier?.report.role_reports).toEqual([]);
    expect(dossier?.evidence.ventures).toEqual(expect.arrayContaining([
      expect.objectContaining({ project_name: "Model Venture", role: "founder", evidence_origin: "model_lead", artifact_verified: false }),
    ]));
    expect(anthropicTools).not.toContain("record_verdict");
  });

  it("reports a coverage-preflight abstention separately from an invalid analyst response", async () => {
    vi.stubEnv("PDL_API_KEY", "pdl-key");
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-key");
    const emitted: Array<{ phase: string; label: string; detail: string }> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("api.peopledatalabs.com")) {
        return new Response(JSON.stringify({
          data: {
            full_name: "Nova Managing Partner",
            job_title: "Managing Partner",
            job_company_name: "Nova Capital",
            linkedin_url: "https://linkedin.com/in/nova-managing-partner",
            experience: [{
              company: { name: "Nova Capital", website: "https://novacap.example" },
              title: { name: "Partner" },
              start_date: "2023",
            }],
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("api.anthropic.com")) {
        const request = JSON.parse(String(init?.body)) as { tool_choice?: { name?: string } };
        const name = request.tool_choice?.name ?? "unknown";
        const toolInput = name === "record_contradictions" ? { contradictions: [] } : {};
        return new Response(JSON.stringify({
          content: [{ type: "tool_use", name, input: toolInput }],
          stop_reason: "tool_use",
          usage: { input_tokens: 100, output_tokens: 20 },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("provider unavailable", { status: 503 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const pending = runAudit("@nova_capital", (step) => emitted.push(step));
    await vi.runAllTimersAsync();
    const dossier = await pending;
    const anthropicTools = fetchMock.mock.calls.flatMap(([input, init]) => {
      if (!String(input).includes("api.anthropic.com")) return [];
      const request = JSON.parse(String(init?.body)) as { tool_choice?: { name?: string } };
      return request.tool_choice?.name ? [request.tool_choice.name] : [];
    });
    const anthropicBodies = fetchMock.mock.calls.flatMap(([input, init]) =>
      String(input).includes("api.anthropic.com") ? [String(init?.body ?? "")] : [],
    );
    const analystRun = dossier?.providerSnapshot?.runs.find((run) => run.id === "ai-analyst");

    expect(anthropicBodies.some((body) =>
      body.includes("Which investments are explicitly attributed to this person"),
    )).toBe(true);
    expect(anthropicTools).toContain("record_contradictions");
    expect(anthropicTools).not.toContain("record_verdict");
    expect(dossier?.report.composite_verdict).toBe("INCOMPLETE");
    expect(dossier?.headline).toContain("substantive evidence is missing");
    expect(emitted).toContainEqual(expect.objectContaining({
      phase: "Analyst",
      label: "Coverage abstention",
      detail: expect.stringContaining("lack substantive eligible evidence"),
    }));
    expect(analystRun).toMatchObject({
      label: "AI analyst",
      state: "skipped",
      detail: expect.stringContaining("coverage preflight abstained"),
    });
    expect(analystRun?.detail).not.toContain("axis result incomplete");
  });

  it("moves curated cap evidence to unverified leads before a live provider run", async () => {
    vi.stubEnv("GITHUB_TOKEN", "github-key");
    const fetchMock = vi.fn().mockResolvedValue(new Response("provider unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    const dossier = await finishAudit("@deltagrowth");

    expect(fetchMock).toHaveBeenCalled();
    expect(dossier?.live).toBe(true);
    expect(dossier?.report.cap_applied).toBeNull();
    expect(dossier?.report.publishable_findings).toEqual([]);
    expect(dossier?.report.investigative_leads).toEqual(expect.arrayContaining([
      expect.objectContaining({
        finding_type: "InvestigatorCallout",
        verification_status: "Rumor",
        independent_source_count: 0,
        evidence_origin: "model_lead",
        artifact_verified: false,
      }),
    ]));
    expect(dossier?.evidence.ventures.every((venture) => venture.outcome === "Unknown")).toBe(true);
  });
});

describe("cold-intake prelude concurrency", () => {
  beforeEach(() => {
    for (const key of PROVIDER_ENV) vi.stubEnv(key, "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("starts the site-liveness fetch while the handle-history call is still in flight", async () => {
    const requested: string[] = [];
    let releaseHistory: (response: Response) => void = () => undefined;
    const historyGate = new Promise<Response>((resolve) => { releaseHistory = resolve; });
    const fetchMock = vi.fn((input: unknown) => {
      const url = String(input);
      requested.push(url);
      if (url.includes("memory.lol")) return historyGate;
      return Promise.resolve(new Response("not found", { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const evidence = emptyEvidence("@subject");
    evidence.profile.bio = "building myproject.xyz";
    const intake = coldIntake({ handle: "@subject", evidence, emit: () => undefined }, true);

    // A serial prelude only issues the site fetch after handle history
    // resolves; the concurrent prelude must have both in flight at once.
    await vi.waitFor(() => {
      expect(requested.some((url) => url.includes("myproject.xyz"))).toBe(true);
      expect(requested.some((url) => url.includes("memory.lol"))).toBe(true);
    });
    releaseHistory(new Response("not found", { status: 404 }));
    await intake;
  });
});
