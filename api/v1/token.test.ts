import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

vi.mock("../_collector.js", async () => {
  const { resolveInput } = await import("../../src/lib/resolveInput");
  return {
    resolveInput: vi.fn(resolveInput),
    auditToken: vi.fn(),
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

vi.mock("../_sanctions-core.js", () => ({
  screenSanctionedAddresses: vi.fn(),
}));

import { consumeInvestigationQuota, requireArgusAuth } from "../_auth.js";
import { auditToken, resolveInput } from "../_collector.js";
import handler from "./token";

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

function request(query: Record<string, string | string[]>): VercelRequest {
  return {
    method: "GET",
    query,
    headers: {},
  } as unknown as VercelRequest;
}

describe("v1 token input guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a repeated query key with a JSON 400 instead of crashing on the array", async () => {
    const address = "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984";
    const { res, captured } = response();

    await handler(request({ address: [address, address] }), res);

    expect(requireArgusAuth).toHaveBeenCalledOnce();
    expect(captured.statusCode).toBe(400);
    expect(captured.body).toEqual({ error: "pass ?address=<contract> or ?url=<dexscreener url>" });
    expect(resolveInput).not.toHaveBeenCalled();
    expect(consumeInvestigationQuota).not.toHaveBeenCalled();
    expect(auditToken).not.toHaveBeenCalled();
  });

  it("skips an array-valued key and falls through to the next valid string key", async () => {
    const url = "https://dexscreener.com/solana/abc123";
    vi.mocked(consumeInvestigationQuota).mockResolvedValue({ allowed: true, remaining: 9, used: 1 });
    vi.mocked(auditToken).mockResolvedValue(null);
    const { res, captured } = response();

    await handler(request({ address: ["a", "b"], url }), res);

    expect(resolveInput).toHaveBeenCalledWith(url);
    expect(captured.statusCode).toBe(404);
  });

  it("still audits a single string contract address", async () => {
    const address = "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984";
    vi.mocked(consumeInvestigationQuota).mockResolvedValue({ allowed: true, remaining: 9, used: 1 });
    vi.mocked(auditToken).mockResolvedValue(null);
    const { res, captured } = response();

    await handler(request({ address }), res);

    expect(resolveInput).toHaveBeenCalledWith(address);
    expect(auditToken).toHaveBeenCalledOnce();
    expect(captured.statusCode).toBe(404);
    expect(captured.body).toEqual({ error: "no DEX pair found for this contract" });
  });
});
