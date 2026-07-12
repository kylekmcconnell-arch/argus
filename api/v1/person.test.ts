import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

vi.mock("../_collector.js", async () => {
  const { resolveInput } = await import("../../src/lib/resolveInput");
  return {
    resolveInput: vi.fn(resolveInput),
    runAudit: vi.fn(),
  };
});

vi.mock("../_auth.js", () => ({
  consumeInvestigationQuota: vi.fn(),
  requireArgusAuth: vi.fn(async () => ({
    userId: "00000000-0000-4000-8000-000000000010",
    email: "analyst@example.com",
    organizationId: "00000000-0000-4000-8000-000000000001",
    role: "analyst",
    displayName: "Analyst",
  })),
}));

vi.mock("../audit.js", () => ({
  persistServerDossier: vi.fn(),
}));

import { consumeInvestigationQuota, requireArgusAuth } from "../_auth.js";
import { resolveInput, runAudit } from "../_collector.js";
import { persistServerDossier } from "../audit.js";
import type { Dossier } from "../../src/data/dossier";
import type { ScanCheck } from "../../src/lib/scanChecklist";
import openapiHandler from "./openapi.json";
import handler, { config } from "./person";
import { DEEP_INVESTIGATION_MAX_DURATION_SECONDS } from "../../src/lib/investigationRuntime";

const AUTH_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";

interface CapturedResponse {
  statusCode: number;
  body: unknown;
  headers: Record<string, unknown>;
}

function response(): { res: VercelResponse; captured: CapturedResponse } {
  const captured: CapturedResponse = { statusCode: 200, body: null, headers: {} };
  const res = {
    status(code: number) { captured.statusCode = code; return this; },
    json(body: unknown) { captured.body = body; return this; },
    setHeader(name: string, value: unknown) { captured.headers[name] = value; return this; },
    end() { return this; },
  } as unknown as VercelResponse;
  return { res, captured };
}

function request(handle: string, query: Record<string, string> = {}): VercelRequest {
  return {
    method: "GET",
    query: { handle, ...query },
    headers: {},
  } as unknown as VercelRequest;
}

function personDossier(input: {
  completeness: "complete" | "partial" | "failed";
  checks: ScanCheck[];
  verdict?: string;
  score?: number | null;
}): Dossier {
  const verdict = input.verdict ?? "PASS";
  const score = input.score === undefined ? 83 : input.score;
  return {
    handle: "@gakonst",
    display_name: "Georgios Konstantopoulos",
    avatar: "",
    bio: "General Partner @paradigm",
    followers: "0",
    joined: "",
    identity_note: "Provider-backed identity",
    headline: "Raw model headline says the evidence is strong.",
    live: true,
    checkRuns: input.checks,
    completeness_state: input.completeness,
    notableFollowers: [],
    contradictions: [],
    webTeam: [],
    report: {
      audit_id: "PA-API-READINESS",
      handle: "@gakonst",
      roles: ["INVESTOR"],
      identity_confidence: "Probable",
      role_reports: [{
        role: "INVESTOR",
        verdict,
        raw_total: score == null ? null : score - 3,
        score_total: score,
        cap_applied: null,
        dox_bonus: 3,
        axes: {},
      }],
      composite_verdict: verdict,
      governing_role: "INVESTOR",
      governing_score: score,
      verdict,
      score_total: score,
      cap_applied: null,
      publishable_findings: [],
      investigative_leads: [],
      finalized_at: "2026-07-12T04:00:00.000Z",
    },
    graph: { nodes: [], edges: [] },
    evidence: {
      ventures: [],
      testimonials: [],
      advised: [],
      associates: [],
      wallets: [],
      promotions: [],
    },
  };
}

describe("v1 person input guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["cashtag", "$PEPEBULL"],
    ["case-folded Solana mint", "52hnekedvx3qmpysyxerquicq3qxxfvchqsetyalpump"],
  ])("rejects a %s before quota, provider, or persistence work", async (_label, input) => {
    const { res, captured } = response();

    await handler(request(input), res);

    expect(requireArgusAuth).toHaveBeenCalledOnce();
    expect(resolveInput).toHaveBeenCalledWith(input);
    expect(captured.statusCode).toBe(400);
    expect(captured.body).toEqual({ error: "pass ?handle=<@handle>" });
    expect(consumeInvestigationQuota).not.toHaveBeenCalled();
    expect(runAudit).not.toHaveBeenCalled();
    expect(persistServerDossier).not.toHaveBeenCalled();
  });

  it("passes only the authenticated organization to the collector", async () => {
    vi.mocked(consumeInvestigationQuota).mockResolvedValue({
      allowed: true,
      remaining: 9,
      used: 1,
    });
    vi.mocked(runAudit).mockResolvedValue(null);
    const { res, captured } = response();

    await handler(request("argus", { organizationId: "attacker-controlled-org" }), res);

    expect(captured.statusCode).toBe(404);
    expect(runAudit).toHaveBeenCalledOnce();
    expect(runAudit).toHaveBeenCalledWith(
      "argus",
      expect.any(Function),
      expect.objectContaining({
        organizationId: AUTH_ORGANIZATION_ID,
        analystDeadlineAt: expect.any(Number),
      }),
    );
    expect(persistServerDossier).not.toHaveBeenCalled();
  });
});

describe("v1 person runtime budget", () => {
  it("matches the deep-investigation route ceiling", () => {
    expect(config).toEqual({ maxDuration: DEEP_INVESTIGATION_MAX_DURATION_SECONDS });
  });
});

describe("v1 person decision-readiness contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(consumeInvestigationQuota).mockResolvedValue({
      allowed: true,
      remaining: 9,
      used: 1,
    });
    vi.mocked(persistServerDossier).mockResolvedValue("1d4b3030-de29-4633-a281-beb9672c4a00");
  });

  it("withholds a partial positive verdict and exposes the raw score only as a preliminary model signal", async () => {
    vi.mocked(runAudit).mockResolvedValue(personDossier({
      completeness: "partial",
      checks: [
        ...Array.from({ length: 9 }, (_, index) => ({ label: `Completed ${index + 1}`, status: "confirmed" as const })),
        { label: "Portfolio verification", status: "unavailable" },
      ],
    }));
    const { res, captured } = response();

    await handler(request("@gakonst"), res);

    expect(captured.statusCode).toBe(200);
    expect(captured.body).toMatchObject({
      verdict: "INCOMPLETE",
      score: null,
      decision_ready: false,
      completeness_state: "partial",
      headline: "Evidence coverage is incomplete. Do not treat the preliminary score as investment clearance.",
      decision_readiness: {
        state: "provisional",
        coverage_percent: 90,
        successful_checks: 9,
        applicable_checks: 10,
        unresolved_checks: 1,
      },
      preliminary_model_signal: {
        verdict: "PASS",
        score: 83,
        headline: "Raw model headline says the evidence is strong.",
        classification: "preliminary",
        roles: [{ role: "INVESTOR", verdict: "PASS", score: 83 }],
      },
      roles: [{ role: "INVESTOR", verdict: "INCOMPLETE", score: null, status: "preliminary" }],
    });
  });

  it("publishes the original verdict and score only after complete frozen coverage", async () => {
    vi.mocked(runAudit).mockResolvedValue(personDossier({
      completeness: "complete",
      checks: Array.from({ length: 10 }, (_, index) => ({ label: `Completed ${index + 1}`, status: "confirmed" as const })),
    }));
    const { res, captured } = response();

    await handler(request("@gakonst"), res);

    expect(captured.body).toMatchObject({
      verdict: "PASS",
      score: 83,
      decision_ready: true,
      completeness_state: "complete",
      headline: "Raw model headline says the evidence is strong.",
      decision_readiness: {
        state: "ready",
        coverage_percent: 100,
        successful_checks: 10,
        applicable_checks: 10,
        unresolved_checks: 0,
      },
      preliminary_model_signal: null,
      roles: [{ role: "INVESTOR", verdict: "PASS", score: 83, status: "final" }],
    });
  });

  it("keeps an incomplete adverse scorer result out of the final fields while retaining the risk signal explicitly", async () => {
    vi.mocked(runAudit).mockResolvedValue(personDossier({
      completeness: "partial",
      checks: [{ label: "Identity", status: "confirmed" }, { label: "Portfolio", status: "unknown" }],
      verdict: "FAIL",
      score: 34,
    }));
    const { res, captured } = response();

    await handler(request("@gakonst"), res);

    expect(captured.body).toMatchObject({
      verdict: "INCOMPLETE",
      score: null,
      decision_ready: false,
      preliminary_model_signal: {
        verdict: "FAIL",
        score: 34,
        classification: "risk_signal",
      },
      roles: [{ verdict: "INCOMPLETE", score: null, status: "preliminary" }],
    });
  });

  it("keeps the canonical UNVERIFIABLE_IDENTITY value in the explicit raw signal", async () => {
    vi.mocked(runAudit).mockResolvedValue(personDossier({
      completeness: "complete",
      checks: [{ label: "Identity", status: "finding" }],
      verdict: "UNVERIFIABLE_IDENTITY",
      score: null,
    }));
    const { res, captured } = response();

    await handler(request("@gakonst"), res);

    expect(captured.body).toMatchObject({
      verdict: "INCOMPLETE",
      score: null,
      decision_ready: false,
      preliminary_model_signal: {
        verdict: "UNVERIFIABLE_IDENTITY",
        score: null,
        classification: "risk_signal",
      },
    });
    expect(JSON.stringify(captured.body)).not.toContain('"verdict":"UNVERIFIABLE"');
  });
});

describe("v1 person OpenAPI readiness contract", () => {
  it("documents INCOMPLETE as the final fail-closed state and separates preliminary model output", () => {
    const { res, captured } = response();

    openapiHandler({} as VercelRequest, res);

    const spec = captured.body as {
      info?: { version?: string };
      components?: { schemas?: Record<string, { enum?: string[]; type?: unknown; properties?: Record<string, unknown> }> };
    };
    expect(spec.info?.version).toBe("1.1.0");
    expect(spec.components?.schemas?.Verdict?.enum).toContain("INCOMPLETE");
    expect(spec.components?.schemas?.PreliminaryPersonModelSignal?.type).toEqual(["object", "null"]);
    expect(spec.components?.schemas?.PersonAudit?.properties).toMatchObject({
      decision_ready: { type: "boolean" },
      completeness_state: { type: "string" },
      decision_readiness: { $ref: "#/components/schemas/DecisionReadiness" },
      preliminary_model_signal: { $ref: "#/components/schemas/PreliminaryPersonModelSignal" },
      score: { type: ["number", "null"] },
    });
  });
});
