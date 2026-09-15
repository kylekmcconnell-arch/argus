import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireArgusAuth, runSweep } = vi.hoisted(() => ({
  requireArgusAuth: vi.fn(),
  runSweep: vi.fn(),
}));

vi.mock("./_auth.js", () => ({ requireArgusAuth }));
vi.mock("./_sweep.js", () => ({ runSweep }));

import handler from "./sweep";

function response() {
  const captured: { status?: number; body?: unknown; allow?: string } = {};
  const res = {
    status(code: number) { captured.status = code; return this; },
    setHeader(name: string, value: string) {
      if (name.toLowerCase() === "allow") captured.allow = value;
      return this;
    },
    json(body: unknown) { captured.body = body; return this; },
  };
  return { res, captured };
}

describe("manual sweep API", () => {
  beforeEach(() => {
    requireArgusAuth.mockReset();
    runSweep.mockReset();
  });

  it("rejects non-GET methods before auth or provider work", async () => {
    const { res, captured } = response();
    await handler({ method: "POST" } as never, res as never);

    expect(captured).toMatchObject({ status: 405, allow: "GET", body: { error: "method_not_allowed" } });
    expect(requireArgusAuth).not.toHaveBeenCalled();
    expect(runSweep).not.toHaveBeenCalled();
  });

  it("does not run without an authenticated analyst", async () => {
    requireArgusAuth.mockResolvedValue(null);
    const { res } = response();
    await handler({ method: "GET" } as never, res as never);

    expect(runSweep).not.toHaveBeenCalled();
  });

  it("scopes the sweep to the authenticated organization with a deadline inside the function ceiling", async () => {
    requireArgusAuth.mockResolvedValue({ organizationId: "org-123" });
    runSweep.mockResolvedValue({ checked: 2, alerts: [] });
    const before = Date.now();
    const { res, captured } = response();
    await handler({ method: "GET" } as never, res as never);

    expect(runSweep).toHaveBeenCalledWith("org-123", { deadlineAt: expect.any(Number) });
    const [, options] = runSweep.mock.calls[0] as [string, { deadlineAt: number }];
    expect(options.deadlineAt).toBeGreaterThan(before + 60_000);
    expect(options.deadlineAt).toBeLessThan(before + 120_000);
    expect(captured).toMatchObject({
      status: 200,
      body: { available: true, checked: 2, alerts: [] },
    });
  });

  // 2026-09-14 deep-dive OR-3: a sweep that reached no backend answered 200
  // with checked: 0, so a rotated credential looked like a clean watchlist.
  it("does not report a completed sweep when no backend answered", async () => {
    requireArgusAuth.mockResolvedValue({ organizationId: "org-123" });
    runSweep.mockResolvedValue({ checked: 0, alerts: [], note: "no backend configured", unavailable: true });
    const { res, captured } = response();
    await handler({ method: "GET" } as never, res as never);

    expect(captured.status).toBe(503);
    expect(captured.body).toMatchObject({ available: false, error: "sweep_backend_unavailable" });
  });

  it("returns a stable code, not the raw error text, when the sweep throws", async () => {
    requireArgusAuth.mockResolvedValue({ organizationId: "org-123" });
    runSweep.mockRejectedValue(new Error("Bearer secret leaked in message"));
    const { res, captured } = response();
    await handler({ method: "GET" } as never, res as never);

    expect(captured.status).toBe(502);
    expect(captured.body).toEqual({ available: false, error: "sweep_failed", checked: 0, alerts: [] });
  });
});
