import { afterEach, describe, expect, it, vi } from "vitest";
import {
  analyzeSubject,
  buildScoringEvidencePacket,
  extractScoringEvidenceCatalog,
  type AnalystAxis,
} from "./agent";
import { getCost, withCostLedger } from "./cost";

describe("Grok analyst fallback", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns a validated founder verdict after Anthropic fails without using followers for track record", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "forced-anthropic-failure");
    vi.stubEnv("XAI_API_KEY", "xai-test-key");
    const axes: AnalystAxis[] = [{
      axis: "F2_track_record",
      weight: 28,
      role: "FOUNDER",
    }];
    const evidenceJson = buildScoringEvidencePacket({
      profile: {
        handle: "@StaniKulechov",
        display_name: "Stani Kulechov",
        resolved_name: "Stani Kulechov",
        followers: "301K",
        profile_collection_state: "resolved",
        profile_provider: "twitterapi",
      },
      basicFacts: [{
        predicate: "founder",
        value: "Aave Labs",
        status: "verified",
        artifact_verified: true,
        sources: [{
          url: "https://aave.com/blog/stable-acquire",
          sourceClass: "official_subject",
          relation: "supports",
          excerpt: "Stani Kulechov, founder of Aave Labs.",
          provider: "public-web",
          artifactVerified: true,
        }],
      }],
    }, axes);
    const catalog = extractScoringEvidenceCatalog(evidenceJson, axes);
    const founderIndex = catalog.findIndex((artifact) =>
      artifact.operation === "basicFacts:founder");
    expect(founderIndex).toBeGreaterThanOrEqual(0);
    const founder = catalog[founderIndex]!;
    const founderAlias = `e${String(founderIndex + 1).padStart(3, "0")}`;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://api.anthropic.com/v1/messages") {
        return new Response(JSON.stringify({ error: { message: "forced canary failure" } }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      expect(url).toBe("https://api.x.ai/v1/chat/completions");
      const request = JSON.parse(String(init?.body)) as {
        response_format?: { type?: string; json_schema?: { name?: string; strict?: boolean } };
      };
      expect(request.response_format).toMatchObject({
        type: "json_schema",
        json_schema: { name: "record_verdict", strict: true },
      });
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              axes: [{
                axis: "F2_track_record",
                score: 22,
                rationale: "The official Aave source verifies that Stani Kulechov founded Aave Labs.",
                primaryEvidenceRef: founderAlias,
                additionalEvidenceRefs: [],
                counterEvidenceRefs: [],
                coverageRefs: [],
                gaps: [],
              }],
              headline: "Official Aave evidence verifies Stani Kulechov's founder relationship.",
              identity_note: "Stani Kulechov is verified as founder of Aave Labs.",
            }),
          },
        }],
        usage: { prompt_tokens: 800, completion_tokens: 120 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    const result = await withCostLedger(async () => {
      const verdict = await analyzeSubject(
        "@StaniKulechov",
        ["FOUNDER"],
        axes,
        evidenceJson,
      );
      return { verdict, cost: getCost() };
    });

    expect(result.verdict).toMatchObject({
      axes: [{
        axis: "F2_track_record",
        evidenceRefs: [founder.artifactId],
      }],
      identity_note: "Stani Kulechov is verified as founder of Aave Labs.",
    });
    expect(result.verdict?.axes[0]?.rationale).not.toMatch(/followers?|301K/i);
    expect(catalog.filter((artifact) => artifact.section === "profile")
      .every((artifact) => !artifact.eligibleAxes.includes("F2_track_record"))).toBe(true);
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "https://api.anthropic.com/v1/messages",
      "https://api.x.ai/v1/chat/completions",
    ]);
    expect(result.cost.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: "claude", op: "record_verdict", status: "failed" }),
      expect.objectContaining({ provider: "grok", op: "record_verdict", status: "succeeded" }),
    ]));
  });
});
