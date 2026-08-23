import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireArgusAuth: vi.fn(),
  collectSocialActivity: vi.fn(),
}));

vi.mock("./_auth.js", () => ({ requireArgusAuth: mocks.requireArgusAuth }));
vi.mock("./_collector.js", () => ({ collectSocialActivity: mocks.collectSocialActivity }));

import handler from "./social-activity";

function response() {
  const captured: { status?: number; body?: unknown; headers: Record<string, string> } = { headers: {} };
  const res = {
    status(code: number) { captured.status = code; return this; },
    json(body: unknown) { captured.body = body; return this; },
    setHeader(key: string, value: string) { captured.headers[key.toLowerCase()] = value; return this; },
  };
  return { res, captured };
}

beforeEach(() => {
  mocks.requireArgusAuth.mockReset().mockResolvedValue({ userId: "user", organizationId: "org", role: "analyst" });
  mocks.collectSocialActivity.mockReset().mockResolvedValue({ schemaVersion: 1, state: "complete" });
});

describe("social activity route", () => {
  it("requires analyst access and forwards only bounded identity inputs", async () => {
    const { res, captured } = response();
    await handler({ method: "POST", body: { handle: "@clutch", ticker: "CLUTCH", projectName: "Clutch Markets" } } as never, res as never);
    expect(mocks.requireArgusAuth).toHaveBeenCalledWith(expect.anything(), res, "analyst");
    expect(mocks.collectSocialActivity).toHaveBeenCalledWith({ handle: "@clutch", ticker: "CLUTCH", projectName: "Clutch Markets" });
    expect(captured.status).toBe(200);
  });

  it("rejects a missing handle before any provider call", async () => {
    const { res, captured } = response();
    await handler({ method: "POST", body: { ticker: "CLUTCH" } } as never, res as never);
    expect(captured.status).toBe(400);
    expect(mocks.collectSocialActivity).not.toHaveBeenCalled();
  });

  it("rejects non-POST methods", async () => {
    const { res, captured } = response();
    await handler({ method: "GET" } as never, res as never);
    expect(captured.status).toBe(405);
    expect(mocks.requireArgusAuth).not.toHaveBeenCalled();
  });
});
