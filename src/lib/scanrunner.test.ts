import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auditToken: vi.fn(),
  reserveInvestigationCredit: vi.fn(),
  scanScopedFetch: vi.fn(() => fetch), collectTokenSocialActivity: vi.fn(),
  streamInvestigation: vi.fn(),
  finishScanReceipt: vi.fn(async () => true),
}));

vi.mock("../token/audit", () => ({ auditToken: mocks.auditToken }));
vi.mock("./investigationCredits", () => ({ reserveInvestigationCredit: mocks.reserveInvestigationCredit }));
vi.mock("./socialActivityClient", () => ({ scanScopedFetch: mocks.scanScopedFetch, collectTokenSocialActivity: mocks.collectTokenSocialActivity }));
vi.mock("./investigation", () => ({ streamInvestigation: mocks.streamInvestigation }));
vi.mock("./scanReceipts", () => ({ finishScanReceipt: mocks.finishScanReceipt }));

import { getScanRun, startInvestigationScan, startTokenScan } from "./scanrunner";

describe("background scan credit gate", () => {
  it("keeps simultaneous scans of the same address on different chains separate", async () => {
    mocks.reserveInvestigationCredit.mockImplementation(() => new Promise(() => {}));
    const ref = "0x0000000000000000000000000000000000000999";
    const a = startTokenScan({kind:"token",via:"evm",ref,chain:"base"});
    const b = startTokenScan({kind:"token",via:"evm",ref,chain:"ethereum"});
    expect(a).not.toBe(b);
    expect(getScanRun("token", `base:${ref}`)).toBe(a);
    expect(getScanRun("token", `ethereum:${ref}`)).toBe(b);
    mocks.reserveInvestigationCredit.mockReset();
  });
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
      // The reservation is wall-clocked so a stalled request cannot hold the
      // run (and every later scan of the subject) open forever.
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mocks.auditToken).toHaveBeenCalledOnce();
    expect(mocks.reserveInvestigationCredit.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.auditToken.mock.invocationCallOrder[0]);
  });
});

describe("forced investigation rescan", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reattaches to a running investigation without another reservation when force is true", async () => {
    const input = { kind: "token", via: "evm", ref: "0x0000000000000000000000000000000000000180" } as const;
    mocks.reserveInvestigationCredit.mockResolvedValue({ chargedCredits: 1, remainingCredits: 10 });
    mocks.streamInvestigation.mockImplementation(() => () => undefined);

    const first = startInvestigationScan(input);
    expect(first.status).toBe("running");
    const second = startInvestigationScan(input, false, { force: true });

    expect(second.id).toBe(first.id);
    expect(second.creditKey).toBe(first.creditKey);
    expect(getScanRun("investigation", input.ref)?.id).toBe(second.id);
    expect(getScanRun("investigation", input.ref)?.status).toBe("running");
    await vi.waitFor(() => expect(mocks.streamInvestigation).toHaveBeenCalled());
    expect(mocks.reserveInvestigationCredit).toHaveBeenCalledOnce();
    expect(mocks.streamInvestigation).toHaveBeenLastCalledWith(
      input,
      expect.any(Object),
      expect.objectContaining({ forceTokenAudit: undefined }),
    );
  });

  it("keeps private and public runs for the same subject separate", async () => {
    const input = { kind: "token", via: "evm", ref: "0x0000000000000000000000000000000000000182" } as const;
    mocks.reserveInvestigationCredit.mockResolvedValue({ chargedCredits: 1, remainingCredits: 10 });
    mocks.streamInvestigation.mockImplementation(() => () => undefined);
    const publicRun = startInvestigationScan(input);
    const privateRun = startInvestigationScan(input, true);
    expect(publicRun.creditKey).not.toBe(privateRun.creditKey);
    expect(getScanRun("investigation", input.ref)).toBe(publicRun);
    expect(getScanRun("investigation", input.ref, true)).toBe(privateRun);
    await vi.waitFor(() => expect(mocks.streamInvestigation).toHaveBeenCalledTimes(2));
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

describe("run lookup across subject ref forms", () => {
  beforeEach(() => vi.clearAllMocks());

  it("finds a chain-qualified investigation rescan when Recent cases clicks the bare address", async () => {
    const ref = "0x00000000000000000000000000000000000001aa";
    mocks.reserveInvestigationCredit.mockResolvedValue({ chargedCredits: 1, remainingCredits: 10 });
    mocks.streamInvestigation.mockImplementation(() => () => undefined);

    const run = startInvestigationScan({ kind: "token", via: "evm", ref, chain: "ethereum" });
    expect(run.ref).toBe(`ethereum:${ref}`);

    expect(getScanRun("investigation", ref)).toBe(run);
    expect(getScanRun("investigation", ref.toUpperCase().replace("0X", "0x"))).toBe(run);
    expect(getScanRun("investigation", `ethereum:${ref}`)).toBe(run);
    expect(getScanRun("token", ref)).toBeUndefined();
  });

  it("finds a bare-address token scan when a durable case opens it chain-qualified", async () => {
    const ref = "0x00000000000000000000000000000000000001ab";
    mocks.reserveInvestigationCredit.mockImplementation(() => new Promise(() => {}));

    const run = startTokenScan({ kind: "token", via: "evm", ref });
    expect(getScanRun("token", `ethereum:${ref}`)).toBe(run);
    expect(getScanRun("token", `base:${ref}`)).toBe(run);
    mocks.reserveInvestigationCredit.mockReset();
  });

  it("re-keys a DexScreener-URL scan to its canonical subject once the collector resolves it", async () => {
    const mint = "So11111111111111111111111111111111111111112";
    const url = "https://dexscreener.com/solana/pairaddress123";
    mocks.reserveInvestigationCredit.mockResolvedValue({ chargedCredits: 1, remainingCredits: 10 });
    mocks.auditToken.mockResolvedValueOnce({ chain: "solana", address: mint, symbol: "SOL" });

    const run = startTokenScan({ kind: "token", via: "dexscreener", ref: url });
    await vi.waitFor(() => expect(getScanRun("token", url)?.status).toBe("done"));

    expect(run.canonicalRef).toBe(`solana:${mint}`);
    expect(getScanRun("token", `solana:${mint}`)).toBe(run);
    expect(getScanRun("token", mint)).toBe(run);
  });

  it("prefers the in-flight rescan over a completed run of the same subject", async () => {
    const ref = "0x00000000000000000000000000000000000001ac";
    mocks.reserveInvestigationCredit.mockResolvedValue({ chargedCredits: 1, remainingCredits: 10 });
    mocks.auditToken.mockResolvedValueOnce({ chain: "ethereum", address: ref, symbol: "ONE" });
    const done = startTokenScan({ kind: "token", via: "evm", ref });
    await vi.waitFor(() => expect(done.status).toBe("done"));

    mocks.reserveInvestigationCredit.mockImplementation(() => new Promise(() => {}));
    const running = startTokenScan({ kind: "token", via: "evm", ref, chain: "ethereum" });
    expect(running).not.toBe(done);
    expect(getScanRun("token", ref)).toBe(running);
    mocks.reserveInvestigationCredit.mockReset();
  });
});

describe("credit reservation receipts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("receipts a refused reservation as such, with no credit charged and no collection started", async () => {
    const input = { kind: "token", via: "evm", ref: "0x00000000000000000000000000000000000001ad" } as const;
    mocks.reserveInvestigationCredit.mockRejectedValueOnce(new Error("You have no investigation credits left."));

    const run = startTokenScan(input);
    await vi.waitFor(() => expect(getScanRun("token", input.ref)?.status).toBe("error"));

    expect(mocks.auditToken).not.toHaveBeenCalled();
    expect(run.chargedCredits).toBe(0);
    expect(mocks.finishScanReceipt).toHaveBeenCalledOnce();
    expect(mocks.finishScanReceipt).toHaveBeenCalledWith(expect.objectContaining({
      runKey: run.creditKey,
      status: "failed",
      failureCode: "credit_reservation_failed",
      creditsCharged: 0,
    }));
  });

  it("carries the reservation's charged credits into a collection failure receipt", async () => {
    const ref = "0x00000000000000000000000000000000000001ae";
    mocks.reserveInvestigationCredit.mockResolvedValueOnce({ chargedCredits: 1, remainingCredits: 9 });
    mocks.streamInvestigation.mockImplementationOnce((_input: unknown, handlers: { onError: (error: string) => void }) => {
      handlers.onError("provider outage");
      return () => undefined;
    });

    const run = startInvestigationScan({ kind: "token", via: "evm", ref });
    await vi.waitFor(() => expect(run.status).toBe("error"));

    expect(mocks.finishScanReceipt).toHaveBeenCalledWith(expect.objectContaining({
      failureCode: "collection_failed",
      creditsCharged: 1,
    }));
  });
});
