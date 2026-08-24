import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./_auth.js", () => ({
  requireArgusAuth: vi.fn(),
  consumeInvestigationQuota: vi.fn(),
}));
vi.mock("./_scanReceipts.js", () => ({ recordScanReceipt: vi.fn() }));

import { consumeInvestigationQuota, requireArgusAuth } from "./_auth.js";
import { recordScanReceipt } from "./_scanReceipts.js";
import handler from "./investigation-credit";

const auth = { userId: "user", organizationId: "org", role: "analyst", email: "a@example.com", displayName: "A" };
function response() {
  const captured = { status: 0, body: null as unknown };
  const res = {
    setHeader: vi.fn().mockReturnThis(),
    status(code: number) { captured.status = code; return this; },
    json(body: unknown) { captured.body = body; return this; },
  };
  return { res: res as never, captured };
}

describe("POST /api/investigation-credit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireArgusAuth).mockResolvedValue(auth as never);
    vi.mocked(recordScanReceipt).mockResolvedValue(true);
  });

  it("returns the charged and remaining visible credits", async () => {
    vi.mocked(consumeInvestigationQuota).mockResolvedValue({ allowed: true, used: 1, remaining: 49_999 });
    const { res, captured } = response();
    await handler({ method: "POST", body: { idempotencyKey: "scan-key-123", kind: "token", canonicalRef: "0xabc", displayQuery: "$ARGUS" } } as never, res);
    expect(captured).toEqual({ status: 200, body: { allowed: true, chargedCredits: 1, remainingCredits: 49_999, receiptRecorded: true } });
    expect(consumeInvestigationQuota).toHaveBeenCalledWith(
      auth,
      "/api/investigation-credit",
      { kind: "token" },
      "scan-key-123",
    );
  });

  it("returns an explicit reason and balance when credits are exhausted", async () => {
    vi.mocked(consumeInvestigationQuota).mockResolvedValue({ allowed: false, used: 0, remaining: 0, creditRemaining: 0, reason: "credit_budget_exhausted" });
    const { res, captured } = response();
    await handler({ method: "POST", body: { idempotencyKey: "scan-key-123", kind: "investigation", canonicalRef: "0xabc", displayQuery: "$ARGUS" } } as never, res);
    expect(captured.status).toBe(429);
    expect(captured.body).toMatchObject({ error: "credit_budget_exhausted", remainingCredits: 0 });
  });
});
