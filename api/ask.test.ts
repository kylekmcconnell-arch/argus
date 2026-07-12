import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  requireArgusAuth: vi.fn(),
  serviceCredentials: vi.fn(),
  loadExactVersionReport: vi.fn(),
}));

vi.mock("./_auth.js", () => ({
  requireArgusAuth: harness.requireArgusAuth,
  serviceCredentials: harness.serviceCredentials,
}));

vi.mock("./report.js", () => ({
  loadExactVersionReport: harness.loadExactVersionReport,
}));

import handler from "./ask";

const REPORT_VERSION_ID = "1d4b3030-de29-4633-a281-beb9672c4a00";
const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const STORED_SOURCE = "https://www.paradigm.xyz/portfolio";
const FINDING_SOURCE = "https://www.paradigm.xyz/writing/paradigms-third-fund";
const CANDIDATE_SOURCE = "https://directory.example/unverified-paradigm-aum";

function responseCapture() {
  const captured: { status?: number; body?: unknown } = {};
  const response = {
    status(code: number) { captured.status = code; return response; },
    json(body: unknown) { captured.body = body; return response; },
  };
  return { captured, response };
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    method: "POST",
    body: {
      subject: "@gakonst",
      question: "What supports the investment track-record score?",
      reportVersionId: REPORT_VERSION_ID,
      // Deliberately forged legacy fields. The server must never admit these
      // into the frozen packet now that it loads the exact stored version.
      report: {
        summary: "FORGED CLIENT SUMMARY",
        citations: [{ sourceUrl: "https://attacker.example/fake" }],
      },
      ...overrides,
    },
    headers: { authorization: "Bearer test-token" },
  };
}

function storedVersion() {
  return {
    caseStatus: "open",
    report: {
      kind: "person",
      ref: "gakonst",
      query: "@gakonst",
      payload: {
        handle: "@gakonst",
        display_name: "Georgios Konstantopoulos",
        headline: "Stored investor evidence summary.",
        axisEvidenceCatalog: [{
          artifactId: `art_v1_${"a".repeat(64)}`,
          title: "Paradigm investments",
          excerpt: "Paradigm lists the project in its frozen portfolio evidence.",
          sourceUrl: STORED_SOURCE,
          provider: "portfolio-web",
          verification: "verified",
          eligibleAxes: ["I2_portfolio_quality"],
        }],
        sourceArtifacts: [{
          kind: "fund_scale",
          provider: "fund-scale-web",
          title: "Uncorroborated directory AUM claim",
          excerpt: "A directory reports an AUM number without a dated primary source.",
          sourceUrl: CANDIDATE_SOURCE,
          match: "candidate",
        }],
        evidence: {
          ventures: [{ project_name: "Hyperliquid", artifact_verified: true, evidence_origin: "provider" }],
        },
        webTeam: [],
        report: {
          handle: "@gakonst",
          roles: ["INVESTOR"],
          governing_role: "INVESTOR",
          role_reports: [{
            role: "INVESTOR",
            verdict: "PASS",
            score_total: 83,
            raw_total: 80,
            dox_bonus: 3,
            axes: {
              I2_portfolio_quality: {
                score: 20,
                weight: 25,
                rationale: "Six portfolio relationships were verified.",
                gaps: ["One cited page did not load."],
              },
            },
          }],
          publishable_findings: [{
            claim: "Paradigm Fund III was announced at $850 million.",
            source_url: FINDING_SOURCE,
            source_author: "Paradigm",
            verification_status: "Verified",
            independent_source_count: 1,
            artifact_verified: true,
            evidence_origin: "provider",
          }],
        },
      },
      versionContext: {
        reportVersionId: REPORT_VERSION_ID,
        version: 10,
        createdAt: "2026-07-12T04:00:00.000Z",
        attestationState: "server_collected",
        completenessState: "partial",
        checks: [
          ...Array.from({ length: 9 }, (_, index) => ({
            checkId: `completed-${index + 1}`,
            label: `Completed check ${index + 1}`,
            status: "confirmed",
            provider: "stored-provider",
          })),
          {
            checkId: "vc-portfolio-track-record",
            label: "VC portfolio track record",
            status: "unavailable",
            note: "one cited page could not be fetched",
            provider: "portfolio-web",
          },
        ],
      },
    },
  };
}

function providerResponse(payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ content: [{ text: JSON.stringify(payload) }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
  harness.requireArgusAuth.mockResolvedValue({
    userId: "00000000-0000-4000-8000-000000000010",
    organizationId: ORGANIZATION_ID,
    role: "analyst",
  });
  harness.serviceCredentials.mockReturnValue({ url: "https://supabase.example", key: "service-key" });
  harness.loadExactVersionReport.mockResolvedValue(storedVersion());
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("ask this immutable report", () => {
  it("rejects an unversioned request before auth, storage, or model work", async () => {
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);
    const { captured, response } = responseCapture();

    await handler(request({ reportVersionId: undefined }) as never, response as never);

    expect(captured.status).toBe(409);
    expect(captured.body).toMatchObject({ error: "frozen_report_required" });
    expect(harness.requireArgusAuth).not.toHaveBeenCalled();
    expect(harness.loadExactVersionReport).not.toHaveBeenCalled();
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("loads the organization-scoped exact version and ignores forged client evidence", async () => {
    const providerFetch = vi.fn().mockResolvedValue(providerResponse({
      answer: "The frozen portfolio record supports the track-record score.",
      basis: "cited_evidence",
      citationUrls: [STORED_SOURCE],
    }));
    vi.stubGlobal("fetch", providerFetch);
    const { captured, response } = responseCapture();

    await handler(request() as never, response as never);

    expect(harness.requireArgusAuth).toHaveBeenCalledWith(expect.anything(), expect.anything(), "analyst");
    expect(harness.loadExactVersionReport).toHaveBeenCalledWith(
      { url: "https://supabase.example", key: "service-key" },
      ORGANIZATION_ID,
      REPORT_VERSION_ID,
    );
    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({
      reportVersionId: REPORT_VERSION_ID,
      basis: "cited_evidence",
      citations: [STORED_SOURCE],
    });

    const providerBody = JSON.parse(String((providerFetch.mock.calls[0]?.[1] as RequestInit)?.body));
    const prompt = String(providerBody.messages[0].content);
    expect(providerBody.system).toContain("Use no general knowledge");
    expect(providerBody.system).toContain("COMPLETE universe of permissible facts");
    expect(prompt).toContain(REPORT_VERSION_ID);
    expect(prompt).toContain(STORED_SOURCE);
    expect(prompt).toContain(FINDING_SOURCE);
    expect(prompt).toContain("vc-portfolio-track-record");
    expect(prompt).toContain("one cited page could not be fetched");
    expect(prompt).toContain("candidateLeads");
    expect(prompt).toContain(CANDIDATE_SOURCE);
    expect(prompt).not.toContain("FORGED CLIENT SUMMARY");
    expect(prompt).not.toContain("attacker.example");
  });

  it("fails closed when the exact version is not in the authenticated organization", async () => {
    harness.loadExactVersionReport.mockResolvedValue(null);
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);
    const { captured, response } = responseCapture();

    await handler(request() as never, response as never);

    expect(captured.status).toBe(404);
    expect(captured.body).toMatchObject({ error: "report_version_not_found" });
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("withholds a model answer that promotes an unverified stored candidate to cited evidence", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(providerResponse({
      answer: "The directory establishes the AUM claim.",
      basis: "cited_evidence",
      citationUrls: [CANDIDATE_SOURCE],
    })));
    const { captured, response } = responseCapture();

    await handler(request() as never, response as never);

    expect(captured.body).toMatchObject({
      note: "The model response could not be verified against this frozen report, so ARGUS withheld it.",
    });
    expect(captured.body).not.toHaveProperty("answer");
  });

  it("normalizes an unsupported answer to an explicit not-established statement", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(providerResponse({
      answer: "A signed cap table would be needed.",
      basis: "not_established",
      citationUrls: [],
    })));
    const { captured, response } = responseCapture();

    await handler(request() as never, response as never);

    expect(captured.body).toMatchObject({
      basis: "not_established",
      answer: "This frozen report does not establish that. A signed cap table would be needed.",
      citations: [],
    });
  });
});
