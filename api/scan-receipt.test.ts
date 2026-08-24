import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./_auth.js", () => ({ requireArgusAuth: vi.fn() }));
vi.mock("./_scanReceipts.js", () => ({ recordScanReceipt: vi.fn() }));

import { requireArgusAuth } from "./_auth.js";
import { recordScanReceipt } from "./_scanReceipts.js";
import handler from "./scan-receipt";

const auth = { userId: "u", organizationId: "o", role: "analyst", email: "a@example.com", displayName: "A" };
const response = () => {
  const captured = { status: 0, body: null as unknown };
  const res = { setHeader: vi.fn().mockReturnThis(), status(code: number) { captured.status = code; return this; }, json(body: unknown) { captured.body = body; return this; } };
  return { captured, res: res as never };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireArgusAuth).mockResolvedValue(auth as never);
  vi.mocked(recordScanReceipt).mockResolvedValue(true);
});

describe("POST /api/scan-receipt", () => {
  it("accepts an analyst-authenticated terminal receipt", async () => {
    const { captured, res } = response();
    await handler({ method: "POST", body: { runKey: "scan-key-123", kind: "token", canonicalRef: "0xabc", displayQuery: "$ARGUS", status: "complete", startedAt: "2026-08-23T20:00:00Z", finishedAt: "2026-08-23T20:00:01Z", durationMs: 1000 } } as never, res);
    expect(captured).toEqual({ status: 200, body: { ok: true } });
    expect(requireArgusAuth).toHaveBeenCalledWith(expect.anything(), expect.anything(), "analyst");
  });

  it("rejects a running state from the terminal endpoint", async () => {
    const { captured, res } = response();
    await handler({ method: "POST", body: { kind: "token", status: "running" } } as never, res);
    expect(captured.status).toBe(400);
    expect(recordScanReceipt).not.toHaveBeenCalled();
  });
});
