import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const { issuePanelCostToken } = vi.hoisted(() => ({
  issuePanelCostToken: vi.fn(),
}));

vi.mock("./_cache.js", () => ({ issuePanelCostToken }));

vi.mock("./_collector.js", async () => {
  const { resolveInput } = await import("../src/lib/resolveInput");
  return {
    resolveInput: vi.fn(resolveInput),
    runAudit: vi.fn(),
  };
});

vi.mock("./_auth.js", () => ({
  consumeInvestigationQuota: vi.fn(),
  requireArgusAuth: vi.fn(async () => ({
    userId: "00000000-0000-4000-8000-000000000010",
    email: "analyst@example.com",
    organizationId: "00000000-0000-4000-8000-000000000001",
    role: "analyst",
    displayName: "Analyst",
  })),
  serviceCredentials: vi.fn(),
  serviceHeaders: vi.fn(),
}));

vi.mock("./_provenance.js", () => ({
  activateReportVersion: vi.fn(),
  persistProvenance: vi.fn(),
}));

import { consumeInvestigationQuota, requireArgusAuth, serviceCredentials } from "./_auth.js";
import { resolveInput, runAudit } from "./_collector.js";
import handler from "./audit";

const AUTH_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";

interface CapturedResponse {
  statusCode: number;
  body: unknown;
  chunks: string[];
}

function response(): { res: VercelResponse; captured: CapturedResponse } {
  const captured: CapturedResponse = { statusCode: 200, body: null, chunks: [] };
  const res = {
    status(code: number) { captured.statusCode = code; return this; },
    json(body: unknown) { captured.body = body; return this; },
    setHeader() { return this; },
    writeHead(code: number) { captured.statusCode = code; return this; },
    flushHeaders() { return this; },
    write(chunk: unknown) { captured.chunks.push(String(chunk)); return true; },
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

describe("person audit input guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    issuePanelCostToken.mockReturnValue("signed-panel-token");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["cashtag", "$PEPEBULL"],
    ["case-folded Solana mint", "52hnekedvx3qmpysyxerquicq3qxxfvchqsetyalpump"],
  ])("rejects a %s before quota or provider work", async (_label, input) => {
    const { res, captured } = response();

    await handler(request(input), res);

    expect(requireArgusAuth).toHaveBeenCalledOnce();
    expect(resolveInput).toHaveBeenCalledWith(input);
    expect(captured.statusCode).toBe(400);
    expect(captured.body).toEqual({ error: "valid_handle_required" });
    expect(consumeInvestigationQuota).not.toHaveBeenCalled();
    expect(runAudit).not.toHaveBeenCalled();
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

    expect(captured.statusCode).toBe(200);
    expect(runAudit).toHaveBeenCalledOnce();
    expect(runAudit).toHaveBeenCalledWith(
      "argus",
      expect.any(Function),
      { organizationId: AUTH_ORGANIZATION_ID },
    );
  });

  it("issues a panel-cost capability only after fresh persistence succeeds", async () => {
    const reportVersionId = "00000000-0000-4000-8000-000000000301";
    vi.mocked(consumeInvestigationQuota).mockResolvedValue({ allowed: true, remaining: 9, used: 1 });
    vi.mocked(serviceCredentials).mockReturnValue({ url: "https://database.example", key: "service-key" });
    vi.mocked(runAudit).mockResolvedValue({
      live: true,
      handle: "@argus",
      report: {
        audit_id: "audit-run-1",
        composite_verdict: "PASS",
        governing_score: 81,
      },
      checkRuns: [],
      providerSnapshot: { capturedAt: "2026-07-11T00:00:00.000Z", runs: [] },
    } as never);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify([{ report_version_id: reportVersionId }]),
      { status: 200, headers: { "content-type": "application/json" } },
    )));
    const { res, captured } = response();

    await handler(request("argus"), res);

    expect(issuePanelCostToken).toHaveBeenCalledWith(AUTH_ORGANIZATION_ID, reportVersionId);
    const stream = captured.chunks.join("");
    expect(stream).toContain("event: done\n");
    const done = JSON.parse(stream.match(/event: done\ndata: ([^\n]+)\n\n/)?.[1] ?? "null");
    expect(done.persistence).toEqual({
      state: "persisted",
      reportVersionId,
      panelCostToken: "signed-panel-token",
    });
  });

  it("does not issue a capability for a private, unpersisted run", async () => {
    vi.mocked(consumeInvestigationQuota).mockResolvedValue({ allowed: true, remaining: 9, used: 1 });
    vi.mocked(runAudit).mockResolvedValue({
      live: true,
      handle: "@argus",
      report: { audit_id: "private-run", composite_verdict: "PASS", governing_score: 81 },
    } as never);
    const { res, captured } = response();

    await handler(request("argus", { private: "1" }), res);

    expect(issuePanelCostToken).not.toHaveBeenCalled();
    const stream = captured.chunks.join("");
    const done = JSON.parse(stream.match(/event: done\ndata: ([^\n]+)\n\n/)?.[1] ?? "null");
    expect(done.persistence).toEqual({ state: "private", reportVersionId: null });
  });
});
