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

  it("reports a capped provider read as a floor instead of a complete total", async () => {
    const versionId = "11111111-1111-4111-8111-111111111111";
    vi.mocked(requireArgusAuth).mockResolvedValue({ organizationId: "org-1", userId: "user-1", role: "owner" } as never);
    vi.mocked(serviceCredentials).mockReturnValue({ url: "https://db.test", key: "service-key" } as never);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const body = url.includes("/scan_run_receipts")
        ? [{ id: "22222222-2222-4222-8222-222222222222", run_key: "run-key-0001", initiated_by: "33333333-3333-4333-8333-333333333333", route: "/api/audit", kind: "token", canonical_ref: "argus", display_query: "$ARGUS", private_run: false, status: "complete", credits_charged_millis: 1000, report_version_id: versionId, provider_cost_usd: null, cost_basis: "unknown", started_at: "2026-08-23T20:00:00Z", finished_at: "2026-08-23T20:00:02Z", duration_ms: 2000 }]
        : url.includes("/report_versions")
          ? [{ id: versionId, case_id: "44444444-4444-4444-8444-444444444444", version: 1, completeness_state: "complete" }]
          : url.includes("/provider_usage_events")
            // Exactly the cap: the read is full, so rows were left unread.
            ? Array.from({ length: 5000 }, (_, index) => ({ id: `event-${index}`, report_version_id: versionId, provider: "X", operation: "post_search", calls: 1, usd: 0.001, status: "succeeded", meta: "" }))
            : [];
      return new Response(JSON.stringify(body), { status: 200 });
    }));
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), setHeader: vi.fn().mockReturnThis() };
    await handler({ method: "GET", query: {} } as never, res as never);
    const payload = res.json.mock.calls[0][0] as { totals: { providerCostIsFloor: boolean; truncated: { providerEvents: boolean; checks: boolean } } };
    expect(payload.totals.providerCostIsFloor).toBe(true);
    expect(payload.totals.truncated).toEqual({ providerEvents: true, checks: false });
    vi.unstubAllGlobals();
  });
});
