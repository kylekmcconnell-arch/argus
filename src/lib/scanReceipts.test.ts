import { afterEach, describe, expect, it, vi } from "vitest";
import { finishScanReceipt } from "./scanReceipts";

afterEach(() => vi.unstubAllGlobals());

describe("client scan receipts", () => {
  it("sends a terminal receipt without changing the scan result", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(finishScanReceipt({ runKey: "scan-key-123", kind: "token", canonicalRef: "0xabc", displayQuery: "$ARGUS", privateRun: false, startedAt: Date.now() - 100, status: "degraded", failureCode: "persistence_failed", failureDetail: "Report save failed." })).resolves.toBe(true);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ runKey: "scan-key-123", status: "degraded", creditsCharged: 1, failureCode: "persistence_failed", costBasis: "unknown" });
  });

  it("remains best effort when the receipt endpoint is down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    await expect(finishScanReceipt({ runKey: "scan-key-123", kind: "token", canonicalRef: "0xabc", displayQuery: "$ARGUS", privateRun: false, startedAt: Date.now(), status: "complete" })).resolves.toBe(false);
  });
});
