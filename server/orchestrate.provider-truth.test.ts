import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { providerStatus } from "./config";
import { runAudit } from "./orchestrate";

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
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("provider unavailable", { status: 503 })));

    const dossier = await finishAudit("@satoshi_builds");

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
    expect(dossier?.report.investigative_leads).toEqual(expect.arrayContaining([
      expect.objectContaining({ finding_type: "RoleCandidate", evidence_origin: "model_lead" }),
    ]));
  });

  it("does not let a Grok-only founder affiliation request founder scoring", async () => {
    vi.stubEnv("XAI_API_KEY", "xai-key");
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
