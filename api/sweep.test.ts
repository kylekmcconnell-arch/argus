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

  it("scopes the sweep to the authenticated organization", async () => {
    requireArgusAuth.mockResolvedValue({ organizationId: "org-123" });
    runSweep.mockResolvedValue({ checked: 2, alerts: [] });
    const { res, captured } = response();
    await handler({ method: "GET" } as never, res as never);

    expect(runSweep).toHaveBeenCalledWith("org-123");
    expect(captured).toMatchObject({
      status: 200,
      body: { available: true, checked: 2, alerts: [] },
    });
  });
});
