import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./_auth.js", () => ({
  requireArgusAuth: vi.fn(),
  consumeInvestigationQuota: vi.fn(),
  refundInvestigationCredit: vi.fn(),
}));
vi.mock("./_scanReceipts.js", async () => {
  const actual = await vi.importActual<typeof import("./_scanReceipts.js")>("./_scanReceipts.js");
  return {
    claimScanReceipt: vi.fn(),
    readScanReceipt: vi.fn(),
    scanReceiptClaimInputValid: actual.scanReceiptClaimInputValid,
  };
});

import { consumeInvestigationQuota, refundInvestigationCredit, requireArgusAuth } from "./_auth.js";
import { claimScanReceipt, readScanReceipt } from "./_scanReceipts.js";
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
const reservation = (overrides: Record<string, unknown> = {}) => ({
  method: "POST",
  body: { idempotencyKey: "scan-key-123", kind: "token", canonicalRef: "0xabc", displayQuery: "$ARGUS", startedAt: "2026-09-14T10:00:00.000Z", ...overrides },
}) as never;

describe("POST /api/investigation-credit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireArgusAuth).mockResolvedValue(auth as never);
    vi.mocked(claimScanReceipt).mockResolvedValue("written");
    vi.mocked(refundInvestigationCredit).mockResolvedValue(true);
  });

  it("returns the charged and remaining visible credits", async () => {
    vi.mocked(consumeInvestigationQuota).mockResolvedValue({ allowed: true, used: 1, remaining: 49_999 });
    const { res, captured } = response();
    await handler(reservation(), res);
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
    await handler(reservation({ kind: "investigation" }), res);
    expect(captured.status).toBe(429);
    expect(captured.body).toMatchObject({ error: "credit_budget_exhausted", remainingCredits: 0 });
  });

  // 2026-09-14 deep-dive API-1: the debit and the receipt claim are two calls.
  // The key is the unit of work, so nothing between them may orphan a credit.
  it("rejects a reservation the receipt write would refuse before any credit moves", async () => {
    vi.mocked(consumeInvestigationQuota).mockResolvedValue({ allowed: true, used: 1, remaining: 9 });
    const { res, captured } = response();
    await handler(reservation({ startedAt: "not a time" }), res);
    expect(captured.status).toBe(400);
    expect(captured.body).toMatchObject({ error: "invalid_credit_reservation" });
    expect(consumeInvestigationQuota).not.toHaveBeenCalled();
    expect(claimScanReceipt).not.toHaveBeenCalled();
  });

  it("hands a retried own reservation back with 200 instead of refusing the paid run", async () => {
    vi.mocked(consumeInvestigationQuota).mockResolvedValue({ allowed: true, used: 1, remaining: 9 });
    vi.mocked(claimScanReceipt).mockResolvedValue("duplicate");
    vi.mocked(readScanReceipt).mockResolvedValue({
      initiatedBy: "user", route: "/app/scan", kind: "token", canonicalRef: "0xabc", status: "running", reportVersionId: null,
    });
    const { res, captured } = response();
    await handler(reservation(), res);
    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({ allowed: true, replayed: true, receiptRecorded: true, receiptStatus: "running" });
    expect(refundInvestigationCredit).not.toHaveBeenCalled();
  });

  it("refunds the debit and refuses the key when another analyst's run owns it", async () => {
    vi.mocked(consumeInvestigationQuota).mockResolvedValue({ allowed: true, used: 1, remaining: 9 });
    vi.mocked(claimScanReceipt).mockResolvedValue("duplicate");
    vi.mocked(readScanReceipt).mockResolvedValue({
      initiatedBy: "someone-else", route: "/app/scan", kind: "token", canonicalRef: "0xabc", status: "complete", reportVersionId: "v1",
    });
    const { res, captured } = response();
    await handler(reservation(), res);
    expect(captured.status).toBe(409);
    expect(captured.body).toMatchObject({ error: "scan_run_already_claimed", creditState: "refunded" });
    expect(refundInvestigationCredit).toHaveBeenCalledWith(auth, "scan-key-123", "scan_run_already_claimed");
  });

  it("holds the credit on the key, never refunds, when the claim store is unavailable", async () => {
    vi.mocked(consumeInvestigationQuota).mockResolvedValue({ allowed: true, used: 1, remaining: 9 });
    vi.mocked(claimScanReceipt).mockResolvedValue("unavailable");
    const { res, captured } = response();
    await handler(reservation(), res);
    expect(captured.status).toBe(503);
    expect(captured.body).toMatchObject({ error: "scan_run_claim_unavailable", creditState: "held" });
    expect((captured.body as { message: string }).message).not.toMatch(/no credit was taken/i);
    expect(refundInvestigationCredit).not.toHaveBeenCalled();
  });

  it("says no credit was taken only when the ledger itself failed", async () => {
    vi.mocked(consumeInvestigationQuota).mockResolvedValue({ allowed: false, used: 0, remaining: 0, error: "credit_ledger_unavailable" });
    const { res, captured } = response();
    await handler(reservation(), res);
    expect(captured.status).toBe(503);
    expect(captured.body).toMatchObject({ error: "credit_ledger_unavailable", creditState: "none", message: expect.stringContaining("no credit was taken") });
    expect(claimScanReceipt).not.toHaveBeenCalled();
  });
});
