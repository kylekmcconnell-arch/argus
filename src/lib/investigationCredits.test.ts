import { afterEach, describe, expect, it, vi } from "vitest";
import { reserveInvestigationCredit } from "./investigationCredits";

afterEach(() => vi.unstubAllGlobals());

describe("investigation credit reservations", () => {
  it("sends the scan idempotency key before providers run", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      allowed: true,
      chargedCredits: 1,
      remainingCredits: 49_999,
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(reserveInvestigationCredit("scan-key-123", "investigation")).resolves.toEqual({
      chargedCredits: 1,
      remainingCredits: 49_999,
    });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      idempotencyKey: "scan-key-123",
      kind: "investigation",
    });
  });

  it("surfaces the exact exhausted-credit explanation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: "credit_budget_exhausted",
      remainingCredits: 0,
      message: "You have no investigation credits left. Ask a workspace owner to add credits before starting another scan.",
    }), { status: 429 })));

    await expect(reserveInvestigationCredit("scan-key-123", "token"))
      .rejects.toThrow("You have no investigation credits left");
  });
});
