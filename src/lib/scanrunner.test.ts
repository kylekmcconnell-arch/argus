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

import { getScanRun, startInvestigationScan, startTokenScan } from "./scanrunner";

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
    expect(mocks.reserveInvestigationCredit).toHaveBeenCalledWith(
      run.creditKey, "token", input.ref, input.ref, false, expect.any(String),
    );
    expect(mocks.auditToken).toHaveBeenCalledOnce();
    expect(mocks.reserveInvestigationCredit.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.auditToken.mock.invocationCallOrder[0]);
  });
});

describe("forced investigation rescan", () => {
  beforeEach(() => vi.clearAllMocks());

  it("replaces a running investigation when force is true", async () => {
    const input = { kind: "token", via: "evm", ref: "0x0000000000000000000000000000000000000180" } as const;
    mocks.reserveInvestigationCredit.mockResolvedValue({ chargedCredits: 1, remainingCredits: 10 });
    mocks.streamInvestigation.mockImplementation(() => () => undefined);

    const first = startInvestigationScan(input);
    expect(first.status).toBe("running");
    const second = startInvestigationScan(input, false, { force: true });

    expect(second.id).not.toBe(first.id);
    expect(second.creditKey).not.toBe(first.creditKey);
    expect(getScanRun("investigation", input.ref)?.id).toBe(second.id);
    expect(getScanRun("investigation", input.ref)?.status).toBe("running");
    await vi.waitFor(() => expect(mocks.streamInvestigation).toHaveBeenCalled());
    expect(mocks.streamInvestigation).toHaveBeenLastCalledWith(
      input,
      expect.any(Object),
      expect.objectContaining({ forceTokenAudit: true }),
    );
  });

  it("starts a new investigation after a completed run when force is true", async () => {
    const input = { kind: "token", via: "evm", ref: "0x0000000000000000000000000000000000000181" } as const;
    mocks.reserveInvestigationCredit.mockResolvedValue({ chargedCredits: 1, remainingCredits: 10 });
    mocks.streamInvestigation.mockImplementationOnce((_input, handlers: { onDone: (inv: { token: { address: string } }) => void }) => {
      handlers.onDone({ token: { address: input.ref } });
      return () => undefined;
    });

    startInvestigationScan(input);
    await vi.waitFor(() => expect(getScanRun("investigation", input.ref)?.status).toBe("done"));
    const firstId = getScanRun("investigation", input.ref)!.id;

    mocks.streamInvestigation.mockImplementation(() => () => undefined);
    const second = startInvestigationScan(input, false, { force: true });

    expect(second.id).not.toBe(firstId);
    expect(second.status).toBe("running");
    expect(getScanRun("investigation", input.ref)?.id).toBe(second.id);
  });
});
