import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auditToken: vi.fn(),
  reserveInvestigationCredit: vi.fn(),
  collectTokenSocialActivity: vi.fn(),
  streamInvestigation: vi.fn(),
}));

vi.mock("../token/audit", () => ({ auditToken: mocks.auditToken }));
vi.mock("./investigationCredits", () => ({ reserveInvestigationCredit: mocks.reserveInvestigationCredit }));
vi.mock("./socialActivityClient", () => ({ collectTokenSocialActivity: mocks.collectTokenSocialActivity }));
vi.mock("./investigation", () => ({ streamInvestigation: mocks.streamInvestigation }));

import { getScanRun, startTokenScan } from "./scanrunner";

describe("background scan credit gate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("starts no providers when the credit reservation is rejected", async () => {
    const input = { kind: "token", via: "evm", ref: "0x0000000000000000000000000000000000000173" } as const;
    mocks.reserveInvestigationCredit.mockRejectedValueOnce(new Error("You have no investigation credits left."));

    startTokenScan(input);
    await vi.waitFor(() => expect(getScanRun("token", input.ref)?.status).toBe("error"));

    expect(mocks.auditToken).not.toHaveBeenCalled();
    expect(getScanRun("token", input.ref)?.error).toContain("no investigation credits left");
  });

  it("reserves exactly once before the token provider pipeline starts", async () => {
    const input = { kind: "token", via: "evm", ref: "0x0000000000000000000000000000000000000174" } as const;
    mocks.reserveInvestigationCredit.mockResolvedValueOnce({ chargedCredits: 1, remainingCredits: 49_999 });
    mocks.auditToken.mockResolvedValueOnce(null);

    const run = startTokenScan(input);
    await vi.waitFor(() => expect(getScanRun("token", input.ref)?.status).toBe("error"));

    expect(mocks.reserveInvestigationCredit).toHaveBeenCalledOnce();
    expect(mocks.reserveInvestigationCredit).toHaveBeenCalledWith(run.creditKey, "token");
    expect(mocks.auditToken).toHaveBeenCalledOnce();
    expect(mocks.reserveInvestigationCredit.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.auditToken.mock.invocationCallOrder[0]);
  });
});
