import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  attachPanelCost: vi.fn(),
  claudeUsd: vi.fn(() => 0.04),
  loadExactVersionReport: vi.fn(),
  requireArgusAuth: vi.fn(),
  resolvePanelCostVersion: vi.fn(),
  serviceCredentials: vi.fn(),
}));

vi.mock("./_auth.js", () => ({
  requireArgusAuth: harness.requireArgusAuth,
  serviceCredentials: harness.serviceCredentials,
}));

vi.mock("./_cache.js", () => ({
  attachPanelCost: harness.attachPanelCost,
  claudeUsd: harness.claudeUsd,
  resolvePanelCostVersion: harness.resolvePanelCostVersion,
}));

vi.mock("./report.js", () => ({
  loadExactVersionReport: harness.loadExactVersionReport,
}));

import handler from "./challenge-verdict";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000010";
const REPORT_VERSION_ID = "1d4b3030-de29-4633-a281-beb9672c4a00";

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
    headers: {
      authorization: "Bearer test-token",
      "x-argus-panel-token": "signed-panel-token",
    },
    body: {
      question: "The holder risk looks overstated. Is that supported?",
      subject: "$FORGED",
      verdict: "PASS",
      score: 100,
      evidence: "FORGED CLIENT EVIDENCE",
      reportVersionId: "00000000-0000-4000-8000-000000000999",
      ...overrides,
    },
  };
}

function storedVersion() {
  return {
    caseStatus: "open",
    report: {
      kind: "token",
      ref: "stored-token",
      query: "$STORED",
      verdict: "CAUTION",
      score: 77,
      ts: "2026-08-05T12:00:00.000Z",
      payload: {
        symbol: "STORED",
        chain: "ethereum",
        headline: "Stored immutable headline.",
        findings: [{ tone: "risk", claim: "STORED HOLDER EVIDENCE" }],
        safety: { available: true, honeypot: false, mintable: null },
        topHolders: [{ address: "0x1111", percent: 18.5 }],
        report: { composite_verdict: "CAUTION", governing_score: 77 },
      },
      versionContext: {
        reportVersionId: REPORT_VERSION_ID,
        version: 4,
        createdAt: "2026-08-05T12:00:00.000Z",
        attestationState: "server_collected",
        completenessState: "partial",
        checks: [{
          checkId: "holder-profile",
          label: "Holder concentration",
          status: "confirmed",
          note: "Stored holder profile was captured.",
        }],
      },
    },
  };
}

function storedInvestigationVersion() {
  const exact = storedVersion();
  return {
    ...exact,
    report: {
      ...exact.report,
      kind: "investigation",
      payload: {
        token: exact.report.payload,
        projectX: "@stored_project",
        founders: [{ name: "PROJECT FOUNDER EVIDENCE", role: "Founder" }],
        projectAccountAudit: { state: "complete", note: "Embedded project review completed." },
        projectAccount: {
          handle: "@stored_project",
          headline: "PROJECT ACCOUNT HEADLINE",
          report: { composite_verdict: "CAUTION", governing_score: 64 },
          webTeam: [{ name: "PROJECT TEAM EVIDENCE", role: "Founder", sourceUrl: "https://project.example/team" }],
          intelligence: { signals: [{ headline: "PROJECT INTELLIGENCE EVIDENCE" }] },
          evmControlReality: { chain: "ethereum", target: "0x1111", blockNumber: 123 },
        },
      },
    },
  };
}

function providerResponse(value: unknown): Response {
  return new Response(JSON.stringify({
    content: [{ text: typeof value === "string" ? value : JSON.stringify(value) }],
    usage: { input_tokens: 100, output_tokens: 40 },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
  harness.requireArgusAuth.mockResolvedValue({
    organizationId: ORGANIZATION_ID,
    userId: USER_ID,
    role: "analyst",
  });
  harness.resolvePanelCostVersion.mockReturnValue(REPORT_VERSION_ID);
  harness.serviceCredentials.mockReturnValue({ url: "https://supabase.example", key: "service-key" });
  harness.loadExactVersionReport.mockResolvedValue(storedVersion());
  harness.attachPanelCost.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("challenge an immutable verdict", () => {
  it("loads the token-bound exact version and ignores client-authored decision evidence", async () => {
    const providerFetch = vi.fn().mockResolvedValue(providerResponse({
      recommendation: "uphold",
      confidence: "high",
      summary: "The stored holder evidence supports keeping the original caution.",
      summaryEvidenceRefs: ["ev:primary:topHolders"],
      challenges: [],
    }));
    vi.stubGlobal("fetch", providerFetch);
    const { captured, response } = responseCapture();

    await handler(request() as never, response as never);

    expect(harness.resolvePanelCostVersion).toHaveBeenCalledWith(ORGANIZATION_ID, "signed-panel-token");
    expect(harness.loadExactVersionReport).toHaveBeenCalledWith(
      { url: "https://supabase.example", key: "service-key" },
      ORGANIZATION_ID,
      REPORT_VERSION_ID,
    );
    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({
      available: true,
      reportVersionId: REPORT_VERSION_ID,
      recommendation: "uphold",
      confidence: "high",
      grounding: "validated_frozen_references",
      evidenceReferences: [expect.objectContaining({ id: "ev:primary:topHolders" })],
    });

    const providerBody = JSON.parse(String((providerFetch.mock.calls[0]?.[1] as RequestInit)?.body));
    const prompt = String(providerBody.messages[0].content);
    expect(providerBody.system).toContain("complete universe of permissible facts");
    expect(providerBody.system).toContain("Null means unknown or not recorded");
    expect(prompt).toContain(REPORT_VERSION_ID);
    expect(prompt).toContain("$STORED");
    expect(prompt).toContain("CAUTION");
    expect(prompt).toContain("STORED HOLDER EVIDENCE");
    expect(prompt).not.toContain("$FORGED");
    expect(prompt).not.toContain("FORGED CLIENT EVIDENCE");
    expect(prompt).not.toContain("00000000-0000-4000-8000-000000000999");
  });

  it("preserves missing subject, verdict, score, and evidence fields as null", async () => {
    const exact = storedVersion();
    const report = exact.report as unknown as Record<string, unknown>;
    report.query = "";
    report.ref = "";
    report.verdict = null;
    report.score = null;
    report.payload = {};
    harness.loadExactVersionReport.mockResolvedValue(exact);
    const providerFetch = vi.fn().mockResolvedValue(providerResponse({
      recommendation: "withhold",
      confidence: "low",
      summary: "The frozen report does not contain enough decision evidence to change the result.",
      summaryEvidenceRefs: ["ev:report:decision"],
      challenges: [],
    }));
    vi.stubGlobal("fetch", providerFetch);
    const { response } = responseCapture();

    await handler(request({
      question: "Does the saved verdict hold?",
      subject: "$ATTACKER",
      verdict: "AVOID",
      score: 0,
      evidence: "none found",
    }) as never, response as never);

    const providerBody = JSON.parse(String((providerFetch.mock.calls[0]?.[1] as RequestInit)?.body));
    const prompt = String(providerBody.messages[0].content);
    expect(prompt).toContain('"subject":null');
    expect(prompt).toContain('"verdict":null');
    expect(prompt).toContain('"score":null');
    expect(prompt).toContain('"findings":null');
    expect(prompt).not.toContain("$ATTACKER");
    expect(prompt).not.toContain("none found");
  });

  it("withholds malformed model output instead of defaulting to uphold and medium", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(providerResponse(JSON.stringify({
      recommendation: "uphold",
      summary: "Missing confidence and malformed challenge direction.",
      challenges: [{ direction: "unclear", point: "Not a valid contract row." }],
    }))));
    const { captured, response } = responseCapture();

    await handler(request() as never, response as never);

    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({
      available: true,
      reportVersionId: REPORT_VERSION_ID,
      note: expect.stringContaining("ARGUS withheld it"),
    });
    expect(captured.body).not.toHaveProperty("recommendation");
    expect(captured.body).not.toHaveProperty("confidence");
    expect(captured.body).not.toHaveProperty("summary");
    expect(captured.body).not.toHaveProperty("challenges");
    expect(harness.attachPanelCost).toHaveBeenCalledWith(
      ORGANIZATION_ID,
      REPORT_VERSION_ID,
      expect.objectContaining({ status: "partial", meta: "output_contract_error", usd: 0.04 }),
    );
  });

  it("loads the project-account domains used by an investigation challenge", async () => {
    harness.loadExactVersionReport.mockResolvedValue(storedInvestigationVersion());
    const providerFetch = vi.fn().mockResolvedValue(providerResponse({
      recommendation: "uphold",
      confidence: "medium",
      summary: "The saved project team row supports the recorded project identity.",
      summaryEvidenceRefs: ["ev:project:webTeam"],
      challenges: [],
    }));
    vi.stubGlobal("fetch", providerFetch);
    const { captured, response } = responseCapture();

    await handler(request({ question: "The team looks wrong. Is that supported?" }) as never, response as never);

    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({
      recommendation: "uphold",
      grounding: "validated_frozen_references",
      evidenceReferences: [expect.objectContaining({ id: "ev:project:webTeam" })],
    });
    const providerBody = JSON.parse(String((providerFetch.mock.calls[0]?.[1] as RequestInit)?.body));
    const prompt = String(providerBody.messages[0].content);
    expect(prompt).toContain("PROJECT TEAM EVIDENCE");
    expect(prompt).toContain("PROJECT INTELLIGENCE EVIDENCE");
    expect(prompt).toContain("ev:project:webTeam");
  });

  it("withholds a challenged domain when its frozen evidence was truncated", async () => {
    const exact = storedVersion();
    exact.report.payload.topHolders = Array.from({ length: 65 }, (_, index) => ({
      address: `0x${index.toString(16).padStart(40, "0")}`,
      percent: 1,
    }));
    harness.loadExactVersionReport.mockResolvedValue(exact);
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);
    const { captured, response } = responseCapture();

    await handler(request({ question: "Is the holder risk overstated?" }) as never, response as never);

    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({
      available: true,
      reportVersionId: REPORT_VERSION_ID,
      evidenceComplete: false,
      unsupportedDomains: expect.arrayContaining([expect.objectContaining({ domain: "market", reason: "bounded" })]),
      note: expect.stringContaining("No model review was run"),
    });
    expect(captured.body).not.toHaveProperty("recommendation");
    expect(providerFetch).not.toHaveBeenCalled();
    expect(harness.attachPanelCost).not.toHaveBeenCalled();
  });

  it("omits credential-bearing frozen URLs and withholds before a provider call", async () => {
    const exact = storedVersion();
    (exact.report.payload as typeof exact.report.payload & { sourceArtifacts: unknown[] }).sourceArtifacts = [{
      title: "Private evidence receipt",
      sourceUrl: "https://evidence.example/report?api_key=must-not-leave-store",
    }];
    harness.loadExactVersionReport.mockResolvedValue(exact);
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);
    const { captured, response } = responseCapture();

    await handler(request({ question: "Is the source evidence valid?" }) as never, response as never);

    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({
      evidenceComplete: false,
      unsupportedDomains: expect.arrayContaining([
        expect.objectContaining({ domain: "provenance", reason: "bounded" }),
      ]),
      note: expect.stringContaining("No model review was run"),
    });
    expect(JSON.stringify(captured.body)).not.toContain("must-not-leave-store");
    expect(providerFetch).not.toHaveBeenCalled();
    expect(harness.attachPanelCost).not.toHaveBeenCalled();
  });

  it("withholds structurally valid prose whose frozen evidence refs are missing or forged", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(providerResponse({
      recommendation: "soften",
      confidence: "high",
      summary: "The holder evidence is less concerning than the report says.",
      summaryEvidenceRefs: ["ev:forged:holder"],
      challenges: [{
        direction: "too_harsh",
        point: "The largest holder is harmless.",
        evidenceRefs: ["ev:forged:holder"],
      }],
    })));
    const { captured, response } = responseCapture();

    await handler(request() as never, response as never);

    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({
      available: true,
      reportVersionId: REPORT_VERSION_ID,
      note: expect.stringContaining("ARGUS withheld it"),
    });
    expect(captured.body).not.toHaveProperty("recommendation");
    expect(harness.attachPanelCost).toHaveBeenCalledWith(
      ORGANIZATION_ID,
      REPORT_VERSION_ID,
      expect.objectContaining({ status: "partial", meta: "output_contract_error" }),
    );
  });

  it("fails closed when the signed version is absent from the authenticated organization", async () => {
    harness.loadExactVersionReport.mockResolvedValue(null);
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);
    const { captured, response } = responseCapture();

    await handler(request() as never, response as never);

    expect(captured.status).toBe(404);
    expect(captured.body).toMatchObject({ error: "report_version_not_found" });
    expect(providerFetch).not.toHaveBeenCalled();
    expect(harness.attachPanelCost).not.toHaveBeenCalled();
  });

  it("rejects a stored payload whose embedded version does not match the panel token", async () => {
    const exact = storedVersion();
    exact.report.versionContext.reportVersionId = "00000000-0000-4000-8000-000000000999";
    harness.loadExactVersionReport.mockResolvedValue(exact);
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);
    const { captured, response } = responseCapture();

    await handler(request() as never, response as never);

    expect(captured.status).toBe(409);
    expect(captured.body).toMatchObject({ error: "report_version_mismatch" });
    expect(providerFetch).not.toHaveBeenCalled();
    expect(harness.attachPanelCost).not.toHaveBeenCalled();
  });
});
