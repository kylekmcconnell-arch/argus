import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./_auth.js", () => ({ requireArgusAuth: vi.fn(), serviceCredentials: vi.fn(), serviceHeaders: vi.fn() }));

import { requireArgusAuth, serviceCredentials } from "./_auth.js";
import handler, { classifyProviderFailure } from "./scan-operations";

beforeEach(() => vi.clearAllMocks());

describe("provider operations failure classification", () => {
  it.each([
    ["credits_or_quota", "quota"], ["http_429", "rate_limit"],
    ["http_401 invalid credential", "authentication"], ["request timeout", "timeout"],
    ["dns transport error", "transport"], ["bad response", "provider_error"],
  ])("maps %s to %s", (meta, expected) => expect(classifyProviderFailure("failed", meta)).toBe(expected));

  it("does not alert on successful or partial provider rows", () => {
    expect(classifyProviderFailure("succeeded", "http_429")).toBeNull();
    expect(classifyProviderFailure("partial", "timeout")).toBeNull();
  });
});

describe("GET /api/scan-operations", () => {
  it("requires workspace-owner access", async () => {
    vi.mocked(requireArgusAuth).mockResolvedValue(null);
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), setHeader: vi.fn().mockReturnThis() };
    await handler({ method: "GET", query: {} } as never, res as never);
    expect(requireArgusAuth).toHaveBeenCalledWith(expect.anything(), expect.anything(), "owner");
    expect(serviceCredentials).not.toHaveBeenCalled();
  });
});
