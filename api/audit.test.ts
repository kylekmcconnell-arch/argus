import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

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

import { consumeInvestigationQuota, requireArgusAuth } from "./_auth.js";
import { resolveInput, runAudit } from "./_collector.js";
import handler from "./audit";

const AUTH_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";

interface CapturedResponse {
  statusCode: number;
  body: unknown;
}

function response(): { res: VercelResponse; captured: CapturedResponse } {
  const captured: CapturedResponse = { statusCode: 200, body: null };
  const res = {
    status(code: number) { captured.statusCode = code; return this; },
    json(body: unknown) { captured.body = body; return this; },
    setHeader() { return this; },
    writeHead(code: number) { captured.statusCode = code; return this; },
    flushHeaders() { return this; },
    write() { return true; },
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
});
